// FTS5 cost on 2,000 Trees / 100,000 Turns.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron bench.mjs <node:sqlite|better-sqlite3>
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { corpus } from './gen.mjs';
const require = createRequire(import.meta.url);
const driver = process.argv[2] ?? 'node:sqlite';
const open = async (p) =>
  driver === 'node:sqlite' ? new (await import('node:sqlite')).DatabaseSync(p) : new (require('better-sqlite3'))(p);

const dir = '/tmp/fts-scratch/data';
mkdirSync(dir, { recursive: true });
const docs = [...corpus()];
const textBytes = docs.reduce((a, d) => a + Buffer.byteLength(d.body), 0);
console.log(`driver ${driver}, electron ${process.versions.electron}, node ${process.versions.node}, sqlite ${process.versions.sqlite}`);
console.log(`corpus: ${docs.length} Turns, ${(textBytes / 1e6).toFixed(1)} MB of text`);

const ms = (f) => { const s = performance.now(); const r = f(); return [performance.now() - s, r]; };
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const size = (p) => statSync(p).size + (existsSync(p + '-wal') ? statSync(p + '-wal').size : 0);
const MB = (b) => (b / 1e6).toFixed(1) + ' MB';

const configs = [
  ['none (LIKE scan)', null],
  ['unicode61 remove_diacritics 2', 'unicode61 remove_diacritics 2'],
  ['porter unicode61 remove_diacritics 2', 'porter unicode61 remove_diacritics 2'],
  ['trigram remove_diacritics 1', 'trigram remove_diacritics 1'],
];

for (const [label, tok] of configs) {
  const p = `${dir}/${label.replace(/\W+/g, '_')}-${driver.replace(/\W+/g, '_')}.sqlite`;
  for (const s of ['', '-wal', '-shm']) rmSync(p + s, { force: true });
  const db = await open(p);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  db.exec('CREATE TABLE turns (rowid INTEGER PRIMARY KEY, tree_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL)');
  db.exec('CREATE INDEX turns_tree ON turns(tree_id)');
  const ins = db.prepare('INSERT INTO turns(rowid, tree_id, kind, body) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  for (const d of docs) ins.run(d.rowid, d.treeId, d.kind, d.body);
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const base = size(p);
  console.log(`\n=== ${label} ===`);
  if (!tok) {
    console.log(`base table: ${MB(base)}`);
    for (const q of ['%pgbounc%', '%postgres%', '%the%']) {
      const st = db.prepare('SELECT rowid, tree_id FROM turns WHERE body LIKE ? LIMIT 50');
      const times = [];
      for (let i = 0; i < 5; i++) times.push(ms(() => st.all(q))[0]);
      const cnt = db.prepare('SELECT count(*) n FROM turns WHERE body LIKE ?').get(q).n;
      console.log(`LIKE ${q}: ${median(times).toFixed(1)} ms (first 50), ${cnt} total matches; count(*) full scan ${ms(() => db.prepare('SELECT count(*) n FROM turns WHERE body LIKE ?').get(q))[0].toFixed(0)} ms`);
    }
    db.close();
    continue;
  }
  // External-content FTS5: the index only, text stays in `turns`.
  db.exec(`CREATE VIRTUAL TABLE turns_fts USING fts5(body, content='turns', content_rowid='rowid', tokenize='${tok}')`);
  const [buildMs] = ms(() => db.exec(`INSERT INTO turns_fts(turns_fts) VALUES('rebuild')`));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const afterBuild = size(p);
  const [optMs] = ms(() => db.exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`));
  // Note: the run recorded in the findings checkpointed before VACUUM, so its "after optimize" figure
  // counted the WAL and was discarded. Checkpointing after VACUUM measures the file correctly.
  db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  const afterOpt = size(p);
  console.log(`base ${MB(base)}; index build ${(buildMs / 1000).toFixed(1)} s; index size ${MB(afterBuild - base)} (${((afterBuild - base) / textBytes * 100).toFixed(0)}% of text); after optimize+VACUUM ${MB(afterOpt - base)}; optimize ${(optMs / 1000).toFixed(1)} s`);

  // Triggers keep it in sync (what a migration would add)
  db.exec(`
    CREATE TRIGGER turns_ai AFTER INSERT ON turns BEGIN
      INSERT INTO turns_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    CREATE TRIGGER turns_ad AFTER DELETE ON turns BEGIN
      INSERT INTO turns_fts(turns_fts, rowid, body) VALUES('delete', old.rowid, old.body);
    END;`);

  const queries = tok.startsWith('trigram')
    ? [['rare substring', '"pgbounc"'], ['common word', '"the"'], ['mid word', '"ostgre"'], ['two words', '"function" AND "error"'], ['CJK 4 chars', '"全文搜索"']]
    : [['rare word prefix', 'pgbounc*'], ['common word', 'the'], ['rare word', 'postgres'], ['two words', 'function error'], ['short prefix', 'fu*']];
  const top = db.prepare(`
    SELECT t.rowid, t.tree_id, snippet(turns_fts, 0, '<b>', '</b>', '…', 12) s
    FROM turns_fts JOIN turns t ON t.rowid = turns_fts.rowid
    WHERE turns_fts MATCH ? ORDER BY rank LIMIT 50`);
  const cnt = db.prepare('SELECT count(*) n FROM turns_fts WHERE turns_fts MATCH ?');
  for (const [qn, q] of queries) {
    const times = [];
    for (let i = 0; i < 5; i++) times.push(ms(() => top.all(q))[0]);
    console.log(`  ${qn.padEnd(16)} ${q.padEnd(24)} top-50 ranked + snippets: ${median(times).toFixed(1).padStart(7)} ms; matches ${cnt.get(q).n}`);
  }
  if (tok.startsWith('trigram')) {
    const st = db.prepare(`SELECT rowid FROM turns_fts WHERE body LIKE ? LIMIT 50`);
    console.log(`  LIKE via trigram '%gbounc%': ${ms(() => st.all('%gbounc%'))[0].toFixed(1)} ms; 2-char LIKE '%東京%' (no index possible): ${ms(() => st.all('%東京%'))[0].toFixed(1)} ms`);
  }

  // Write cost: one finished Reply (~2.5 KB) per transaction, as the app would do at Reply end
  const sample = docs.slice(1, 400).filter((d) => d.kind === 'reply').slice(0, 200);
  let next = docs.length + 1;
  const writes = sample.map((d) => ms(() => { db.exec('BEGIN'); ins.run(next++, 'tree-new', 'reply', d.body); db.exec('COMMIT'); })[0]);
  // Delete one Tree (50 Turns)
  const del = ms(() => { db.exec('BEGIN'); db.prepare('DELETE FROM turns WHERE tree_id = ?').run('tree-7'); db.exec('COMMIT'); })[0];
  console.log(`  insert one Reply + index: median ${median(writes).toFixed(2)} ms; delete a 50-Turn Tree + index: ${del.toFixed(1)} ms`);
  const integ = ms(() => db.exec(`INSERT INTO turns_fts(turns_fts, rank) VALUES('integrity-check', 1)`))[0];
  console.log(`  integrity-check ok (${(integ / 1000).toFixed(1)} s)`);
  db.close();
}
