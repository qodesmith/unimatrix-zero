// Deterministic synthetic corpus: 2,000 Trees, 100,000 Turns (alternating Prompt / Reply).
import { readFileSync } from 'node:fs';

let seed = 42;
export const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const common = `the of and to a in is that it for you this with on as be are can not or your if use
we an by at from have will which but so do what when there more one all can how my also then like
each other into just only some time code file function data error value should would could need make
because about first see new way any these return change test run set get default example using`.split(/\s+/);
const dict = readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter((w) => w.length > 2);
const vocab = [...common];
for (let i = 0; i < 40000; i++) vocab.push(dict[Math.floor(rand() * dict.length)]);
// Zipf-ish sampler
const H = vocab.map((_, i) => 1 / (i + 1));
const cum = [];
H.reduce((a, h, i) => (cum[i] = a + h), 0);
const total = cum[cum.length - 1];
function word() {
  const r = rand() * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
  return vocab[lo];
}
const foreign = [
  'Le café est très crémeux à Paris, et la crème brûlée aussi.',
  'Über die Brücke gehen wir morgen früh.',
  '東京でラーメンを食べました。データベースの全文検索について質問です。',
  '我们使用全文搜索来查找以前的对话内容。',
  'Привет, как настроить базу данных?',
];
function text(chars) {
  const out = [];
  let n = 0;
  while (n < chars) {
    const w = word();
    out.push(w);
    n += w.length + 1;
    if (rand() < 0.07) out[out.length - 1] += '.';
  }
  if (rand() < 0.05) out.push(foreign[Math.floor(rand() * foreign.length)]);
  return out.join(' ');
}
const len = (mean) => Math.max(20, Math.round(-Math.log(1 - rand()) * mean)); // exponential

export function* corpus({ trees = 2000, turns = 100000 } = {}) {
  const perTree = turns / trees;
  let rowid = 0;
  for (let t = 0; t < trees; t++) {
    const treeId = `tree-${t}`;
    for (let i = 0; i < perTree; i++) {
      const kind = i % 2 === 0 ? 'prompt' : 'reply';
      let body = text(kind === 'prompt' ? 300 : 2500);
      rowid++;
      if (rowid % 5000 === 0) body += ' We put PgBouncer in front of Postgres.';
      yield { rowid, treeId, kind, body };
    }
  }
}
export function titleFor(t) {
  return text(40);
}
