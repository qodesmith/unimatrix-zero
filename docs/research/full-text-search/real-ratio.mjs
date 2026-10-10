// Index-size ratio on real conversation text (local Claude Code transcripts; nothing is kept or committed).
// Run: ELECTRON_RUN_AS_NODE=1 npx electron real-ratio.mjs
import { readdirSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const { DatabaseSync } = await import('node:sqlite');

const root = join(homedir(), '.claude/projects');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsonl') && files.push(p); } };
walk(root);
const turns = [];
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.type !== 'user' && j.type !== 'assistant') continue;
  const c = j.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
  if (text.trim()) turns.push(text);
}
const bytes = turns.reduce((a, t) => a + Buffer.byteLength(t), 0);
console.log(`real text: ${turns.length} messages, ${(bytes / 1e6).toFixed(1)} MB`);
const size = (p) => statSync(p).size + (existsSync(p + '-wal') ? statSync(p + '-wal').size : 0);
for (const tok of ['unicode61 remove_diacritics 2', 'porter unicode61 remove_diacritics 2', 'trigram remove_diacritics 1', 'trigram']) {
  const p = '/tmp/fts-scratch/data/real.sqlite';
  for (const s of ['', '-wal', '-shm']) rmSync(p + s, { force: true });
  const db = new DatabaseSync(p);
  db.exec(`CREATE TABLE turns(rowid INTEGER PRIMARY KEY, body TEXT); CREATE VIRTUAL TABLE f USING fts5(body, content='turns', content_rowid='rowid', tokenize='${tok}')`);
  const ins = db.prepare('INSERT INTO turns(body) VALUES (?)');
  db.exec('BEGIN'); for (const t of turns) ins.run(t); db.exec('COMMIT'); db.exec('VACUUM');
  const base = size(p);
  const s = performance.now();
  db.exec(`INSERT INTO f(f) VALUES('rebuild')`); db.exec(`INSERT INTO f(f) VALUES('optimize')`); db.exec('VACUUM');
  const t = performance.now() - s;
  const idx = size(p) - base;
  const like = db.prepare(`SELECT count(*) n FROM f WHERE body LIKE '%sqlite%'`);
  const l0 = performance.now(); const n = like.get().n; const l = performance.now() - l0;
  console.log(`${tok.padEnd(38)} index ${(idx / 1e6).toFixed(1)} MB = ${(idx / bytes * 100).toFixed(0)}% of text; build+optimize ${(t / 1000).toFixed(1)} s; LIKE '%sqlite%' on fts table ${l.toFixed(1)} ms (${n})`);
  db.close();
}
