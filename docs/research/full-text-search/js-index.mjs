// In-memory JS indexes on the same 100k-Turn corpus.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron --js-flags=--expose-gc js-index.mjs <minisearch|flexsearch>
import { corpus } from './gen.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const which = process.argv[2];
const docs = [...corpus()].map((d) => ({ id: d.rowid, body: d.body }));
gc();
const heap0 = process.memoryUsage().heapUsed;
const t0 = performance.now();
let search, serialize;
if (which === 'minisearch') {
  const MiniSearch = require('minisearch');
  const ms = new MiniSearch({ fields: ['body'] });
  ms.addAll(docs);
  search = (q, o) => ms.search(q, o);
  serialize = () => JSON.stringify(ms);
} else {
  const { Index } = require('flexsearch');
  const ix = new Index({ tokenize: 'forward' });
  for (const d of docs) ix.add(d.id, d.body);
  search = (q) => ix.search(q, 50);
  serialize = null;
}
const build = performance.now() - t0;
gc();
const heap = process.memoryUsage().heapUsed - heap0;
console.log(`${which}: build ${(build / 1000).toFixed(1)} s, index heap ~${(heap / 1e6).toFixed(0)} MB (text itself ~142 MB not counted)`);
for (const [q, o] of [['postgres'], ['pgbounc', { prefix: true }], ['postgrse', { fuzzy: 0.2 }], ['the'], ['function error']]) {
  const s = performance.now();
  const r = search(q, o);
  console.log(`  ${q} ${o ? JSON.stringify(o) : ''}: ${(performance.now() - s).toFixed(1)} ms, ${r.length} hits`);
}
if (serialize) {
  const s = performance.now();
  const json = serialize();
  console.log(`  serialized ${(json.length / 1e6).toFixed(0)} MB in ${((performance.now() - s) / 1000).toFixed(1)} s`);
}
