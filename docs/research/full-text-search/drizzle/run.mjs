// Run: ELECTRON_RUN_AS_NODE=1 npx electron run.mjs <step>
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
const step = process.argv[2];
const client = new DatabaseSync('/tmp/fts-scratch/dz/test.sqlite');
const db = drizzle({ client });
client.exec('PRAGMA foreign_keys=OFF'); // ADR 0003 guard
migrate(db, { migrationsFolder: '/tmp/fts-scratch/dz/drizzle' });
console.log('foreign_key_check rows:', client.prepare('PRAGMA foreign_key_check').all().length);
client.exec('PRAGMA foreign_keys=ON');
const q = (s, ...a) => client.prepare(s).all(...a);
if (step === 'seed') {
  client.exec(`INSERT INTO trees VALUES ('t1','A'),('t2','B')`);
  client.exec(`INSERT INTO prompts VALUES ('p1','t1','We put PgBouncer in front'),('p2','t2','Le café crémeux'),('p3','t2','third')`);
  client.exec(`INSERT INTO search_docs(turn_id, tree_id, body) SELECT id, tree_id, body FROM prompts`);
}
if (step === 'delete') client.exec(`DELETE FROM trees WHERE id='t1'`);
console.log('triggers:', q(`SELECT name FROM sqlite_master WHERE type='trigger'`).map((r) => r.name).join(', ') || '(none)');
console.log('search_docs:', JSON.stringify(q('SELECT rowid, turn_id FROM search_docs')));
console.log(`MATCH 'bounc':`, JSON.stringify(q(`SELECT rowid FROM search_fts WHERE search_fts MATCH 'bounc'`)));
console.log(`MATCH 'third':`, JSON.stringify(q(`SELECT rowid FROM search_fts WHERE search_fts MATCH 'third'`)));
try { client.exec(`INSERT INTO search_fts(search_fts, rank) VALUES('integrity-check', 1)`); console.log('integrity-check: ok'); }
catch (e) { console.log('integrity-check FAILED:', e.message); }
