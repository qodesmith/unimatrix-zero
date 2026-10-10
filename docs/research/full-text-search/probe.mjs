// Probe: is FTS5 compiled in, and how do the tokenizers behave?
// Run: ELECTRON_RUN_AS_NODE=1 npx electron probe.mjs   (Electron's Node 24)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DatabaseSync } = await import('node:sqlite');
const BetterSqlite = require('better-sqlite3');

console.log('runtime', process.versions.electron ? `electron ${process.versions.electron}` : 'node', 'node', process.versions.node, 'sqlite', process.versions.sqlite);

const drivers = {
  'node:sqlite': () => new DatabaseSync(':memory:'),
  'better-sqlite3': () => new BetterSqlite(':memory:'),
};

const docs = [
  'We put PgBouncer in front of Postgres to pool connections.',
  'Le café est très crémeux à Paris.',
  'Naïve résumé of the coöperative',
  '東京でラーメンを食べました。',
  '我们使用全文搜索来查找对话。',
  'Running runners ran quickly; the runner runs.',
  'useEffect cleanup in React components',
];

const queries = [
  ['partial word pgbounc', 'pgbounc'],
  ['prefix pgbounc*', 'pgbounc*'],
  ['middle of word "ouncer"', '"ouncer"'],
  ['diacritics: cafe', 'cafe'],
  ['diacritics: resume', 'resume'],
  ['diacritics: naive', 'naive'],
  ['Japanese 3+ chars ラーメン', '"ラーメン"'],
  ['Japanese 2 chars 東京', '"東京"'],
  ['Chinese 全文搜索', '"全文搜索"'],
  ['Chinese 2 chars 搜索', '"搜索"'],
  ['stemming: run', 'run'],
  ['camel: effect', 'effect'],
];

for (const [name, open] of Object.entries(drivers)) {
  const db = open();
  console.log(`\n=== ${name} ===`);
  const opts = db.prepare('PRAGMA compile_options').all().map((r) => Object.values(r)[0]);
  console.log('sqlite_version', Object.values(db.prepare('select sqlite_version() v').get())[0]);
  console.log('FTS-related compile options:', opts.filter((o) => /FTS|ICU|RTREE|JSON|MATH/.test(o)).join(', '));
  for (const mod of ['fts3', 'fts4', 'fts5']) {
    try {
      db.exec(`CREATE VIRTUAL TABLE probe_${mod} USING ${mod}(x)`);
      console.log(`${mod}: available`);
    } catch (e) {
      console.log(`${mod}: NOT available (${e.message})`);
    }
  }
  const tokenizers = {
    unicode61: "unicode61",
    'unicode61 rd2': "unicode61 remove_diacritics 2",
    porter: "porter unicode61 remove_diacritics 2",
    trigram: "trigram",
    'trigram rd1': "trigram remove_diacritics 1",
  };
  const results = {};
  for (const [tn, tok] of Object.entries(tokenizers)) {
    const t = 't_' + tn.replace(/\W/g, '_');
    try {
      db.exec(`CREATE VIRTUAL TABLE ${t} USING fts5(body, tokenize='${tok}')`);
    } catch (e) {
      console.log(`tokenizer ${tn}: FAILED ${e.message}`);
      continue;
    }
    const ins = db.prepare(`INSERT INTO ${t}(body) VALUES (?)`);
    for (const d of docs) ins.run(d);
    for (const [qn, q] of queries) {
      let out;
      try {
        out = db.prepare(`SELECT count(*) n FROM ${t} WHERE ${t} MATCH ?`).get(q).n;
      } catch (e) {
        out = 'ERR ' + e.message;
      }
      (results[qn] ??= {})[tn] = out;
    }
    // LIKE / GLOB through trigram index
    if (tn.startsWith('trigram')) {
      const r = db.prepare(`SELECT count(*) n FROM ${t} WHERE body LIKE ?`).get('%gboun%').n;
      (results['LIKE %gboun%'] ??= {})[tn] = r;
    }
  }
  console.table(results);
  // snippet / highlight demo
  db.exec(`CREATE VIRTUAL TABLE demo USING fts5(body, tokenize='trigram')`);
  db.prepare('INSERT INTO demo(body) VALUES (?)').run(docs[0]);
  console.log('snippet:', db.prepare(`SELECT snippet(demo, 0, '[', ']', '…', 6) s FROM demo WHERE demo MATCH 'bounc'`).get().s);
  console.log('highlight:', db.prepare(`SELECT highlight(demo, 0, '[', ']') s FROM demo WHERE demo MATCH 'bounc'`).get().s);
  // contentless-delete availability (SQLite >= 3.43)
  try {
    db.exec(`CREATE VIRTUAL TABLE cl USING fts5(body, content='', contentless_delete=1)`);
    console.log('contentless_delete=1: available');
  } catch (e) {
    console.log('contentless_delete: NOT available', e.message);
  }
  db.close();
}
