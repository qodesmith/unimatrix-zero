# Full-text search: engine, cost, and how Notion does it

Research for [#43](https://github.com/qodesmith/unimatrix-zero/issues/43), part of the [v1 spec map #1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-10-10.

**Question:** What would full-text search over every Tree cost, and how does good search behave? This feeds the ⌘K search prototype. Already decided in [#34](https://github.com/qodesmith/unimatrix-zero/issues/34): a ⌘K palette searches titles and the text of every Turn, groups results by Tree with snippets, and opens the Tree at the matching Turn. Storage is `node:sqlite` via Drizzle 1.0 rc, with better-sqlite3 13 as fallback ([#8](https://github.com/qodesmith/unimatrix-zero/issues/8), [#11](https://github.com/qodesmith/unimatrix-zero/issues/11)).

Legend: **[ran]** = verified by running code on this machine (Apple Silicon Mac, Electron 44.7.0 = Node 24.21.0 = SQLite 3.53.4, `ELECTRON_RUN_AS_NODE=1`). **[docs]** = from the linked primary source. **[inferred]** = my reasoning, not verified.

## Answer in brief

- **Engine: SQLite FTS5, which is already built into both drivers.** No extra package, no extension loading. [ran]
- **Tokenizer: `unicode61 remove_diacritics 2`, and add a `*` to every word the user types**, so "pgbounc" finds "PgBouncer", "cafe" finds "café", and "resume" finds "résumé". It costs an index about **44% the size of the text**, and queries take well under 10 ms except for very common words (~100 ms). [ran]
- **Not `trigram` by default.** It is the only tokenizer that matches the middle of a word ("bouncer" → "PgBouncer") and Chinese/Japanese text without spaces, but its index is **~2.6–3× the size of the text** (425 MB for a heavy user) and takes 5× longer to build. [ran] Cover Chinese/Japanese with a plain scan fallback instead (~170–190 ms on 100k Turns). [ran]
- **Not `porter`.** Its stemming ("running" → "run") is English-only [docs], and it adds little once every word is a prefix search.
- **No typo tolerance in FTS5.** The `spellfix1` module is not compiled in [ran]. A "did you mean" can be built later from FTS5's own word list (`fts5vocab`, available [ran]). MiniSearch has fuzzy matching but costs ~280 MB of memory at 100k Turns. [ran]
- **Write cost is negligible:** 0.14 ms to index one finished Reply; 4 ms to delete a 50-Turn Tree with its index entries. [ran]
- **Drizzle cannot describe FTS tables or triggers**, but `drizzle-kit generate --custom` makes an empty migration for the hand-written SQL, and it works with the `migrate()` flow. [ran] **Gotcha:** when Drizzle later rebuilds the indexed table, it silently drops the triggers. [ran] So create the triggers from app code after every `migrate()`, or skip triggers and write the index from app code.
- **Index:** Prompt text, the visible text of Replies, Tree titles and attachment file names. **Don't index** thinking (not stored, per #11), tool calls and tool results, Subagent work, or Workspace files.
- **Notion:** empty state is recently visited pages; default sort "Best matches" favours titles and recent edits; filters for title-only, created by, teamspace, "in" a page, and date; sorts by last edited or created. [docs] Its help page doesn't say whether opening a result scrolls to the match.
- **Meaning-based (semantic) search:** neither the Claude nor the ChatGPT subscription offers embeddings, and Anthropic has no embedding model at all. [docs] The only route without API keys is a local model (e.g. a 23 MB all-MiniLM-L6-v2 through transformers.js) plus `sqlite-vec`, whose loading needs `allowExtension: true` in `node:sqlite`. [docs] Not tested.

## 1. Engine

### FTS5 is in both drivers [ran] [docs]

`probe.mjs` (in [`full-text-search/`](full-text-search/)) runs `CREATE VIRTUAL TABLE t USING fts5(x)` and reads `PRAGMA compile_options` in Electron 44's Node:

| Driver | SQLite | FTS5 | FTS3/4 | `contentless_delete` (needs ≥ 3.43) | `trigram remove_diacritics` (needs ≥ 3.45) |
| --- | --- | --- | --- | --- | --- |
| `node:sqlite` (Electron 44.7.0, Node 24.21.0) | 3.53.4 | yes | yes | yes | yes |
| better-sqlite3 13.0.3 (same Electron) | 3.53.4 | yes | yes | yes | yes |
| `node:sqlite` in plain Node 25.9.0 (for comparison) | 3.51.3 | yes | | | |

Sources that say so:

- Node builds its bundled SQLite with `SQLITE_ENABLE_FTS3`, `SQLITE_ENABLE_FTS3_PARENTHESIS`, `SQLITE_ENABLE_FTS5`, `SQLITE_ENABLE_RTREE`, `SQLITE_ENABLE_MATH_FUNCTIONS` and others: [`deps/sqlite/sqlite.gyp` on v24.x](https://github.com/nodejs/node/blob/v24.x/deps/sqlite/sqlite.gyp).
- better-sqlite3 lists `SQLITE_ENABLE_FTS3/FTS3_PARENTHESIS/FTS4/FTS5` among its default compile options: [`docs/compilation.md`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md).
- Neither has ICU, and `spellfix1` is not there (`no such module: spellfix1`). [ran]

So the "if neither" branch of the question does not arise. For comparison, the alternatives were still measured on the same data (section 3).

### Alternatives and their cost [ran]

| Option | Build (100k Turns) | Extra storage / memory | Query | Notes |
| --- | --- | --- | --- | --- |
| **FTS5 `unicode61`** | 4.4–5.1 s, once | **62 MB on disk** (44% of text) | 0.3–10 ms; ~100 ms for "the" | Ranked (BM25), snippets, highlight built in |
| FTS5 `trigram` | 22–25 s, once | **425 MB on disk** (299% of text) | 1–36 ms; ~100 ms for "the" | Middle-of-word and CJK matching |
| Plain `LIKE '%…%'` scan, no index | none | none | **~170–195 ms** per query, every query, growing with text | No ranking or snippets; scans everything when there are few matches |
| MiniSearch 7.2.0 | 18.4 s **every launch** (or load a 132 MB JSON file) | **~283 MB of JS heap** | 0.4–72 ms; fuzzy 5.7 ms | Has prefix and fuzzy (typo) search; must live in memory |
| FlexSearch 0.8.212 (`tokenize: 'forward'`) | 40.7 s every launch | **~372 MB of JS heap** | < 1 ms (stops at 50) | Fastest queries; heaviest memory; no fuzzy by default |

A JS index would have to be rebuilt or loaded on every launch and kept in the main process's memory, separate from the database that is the source of truth (ADR 0001). FTS5 lives in the same file, updates in the same transaction as the Turn, and is backed up and migrated with it.

## 2. Tokenizers

### Behaviour on test sentences [ran]

`probe.mjs` indexes seven sentences with each tokenizer and runs the same queries. Both drivers gave identical results. 1 = found, 0 = not found:

| Query | `unicode61` | `unicode61 remove_diacritics 2` | `porter unicode61 …` | `trigram` | `trigram remove_diacritics 1` |
| --- | --- | --- | --- | --- | --- |
| `pgbounc` (partial word, as typed) | 0 | 0 | 0 | **1** | **1** |
| `pgbounc*` (prefix) | 1 | 1 | 1 | 1 | 1 |
| `"ouncer"` (middle of a word) | 0 | 0 | 0 | **1** | **1** |
| `cafe` → café | 1 | 1 | 1 | 0 | **1** |
| `resume` → résumé, `naive` → naïve | 1 | 1 | 1 | 0 | **1** |
| `ラーメン` (3+ CJK characters) | 0 | 0 | 0 | 1 | 1 |
| `全文搜索` (4 Chinese characters) | 0 | 0 | 0 | 1 | 1 |
| `東京` / `搜索` (2 CJK characters) | 0 | 0 | 0 | **0** | **0** |
| `run` → "Running runners ran" | 0 | 0 | **1** | 1 | 1 |
| `effect` → "useEffect" | 0 | 0 | 0 | 1 | 1 |

What this means:

- **Partial words.** With `unicode61`, add `*` to each typed word and the start of any word matches: "pgbounc" → PgBouncer. This covers type-as-you-go. Only `trigram` matches from the middle of a word ("bouncer", "effect" in "useEffect").
- **Diacritics.** `unicode61` removes them by default (`remove_diacritics 1`). Use `2`, which also handles characters with several diacritics. [docs](https://www.sqlite.org/fts5.html#unicode61_tokenizer) `trigram` keeps them unless `remove_diacritics 1` is set (SQLite ≥ 3.45). **But** with that option set, trigram's indexed `LIKE`/`GLOB` is switched off: "Unless the remove_diacritics option is set, FTS5 tables that use the trigram tokenizer also support indexed GLOB and LIKE pattern matching." [docs](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) This was measured too: `LIKE '%sqlite%'` took 0.5 ms with plain trigram and 5.1 ms with `remove_diacritics 1` on 2.8 MB; at 100k Turns, 164–181 ms, i.e. a full scan. [ran]
- **Non-English and CJK.** `unicode61` splits on spaces and punctuation, so Latin, Cyrillic and Greek work. Chinese and Japanese have no spaces, so a whole sentence becomes one "word" that matches only from its start. `trigram` handles CJK queries of 3+ characters, but "Substrings consisting of fewer than 3 unicode characters do not match any rows" [docs](https://www.sqlite.org/fts5.html#the_trigram_tokenizer), and many Chinese/Japanese words are 2 characters. So both tokenizers need a fallback for short CJK queries. A `LIKE '%…%'` scan of the stored text is that fallback: ~170–190 ms on 100k Turns when matches are rare. [ran]
- **Stemming.** `porter` is "designed for use with English language terms only" [docs](https://www.sqlite.org/fts5.html#porter_tokenizer). With prefix search on every word, it adds little.
- **Snippets with trigram are poor.** FTS5's `snippet()` counts tokens, and for trigram every token is three characters, so `snippet(…, 6)` gave `…g[Bounc]er…`, against a readable phrase with `unicode61`. With trigram, the app would cut snippets itself. [ran]
- **Typo tolerance** ("postgrse" → postgres) is not in FTS5. Options:
  1. **Nothing for v1.** Prefix search already forgives unfinished words. Notion's help page doesn't claim typo tolerance either.
  2. **"Did you mean"** on zero results: read the index's word list through `fts5vocab` (available [ran], [docs](https://www.sqlite.org/fts5.html#the_fts5vocab_virtual_table_module)), and pick the closest word by edit distance in JS.
  3. **A JS index** with fuzzy search (MiniSearch `fuzzy: 0.2` found "postgres" for "postgrse" in 5.7 ms [ran]), at the memory cost in section 1.

### Recommendation

Use `unicode61 remove_diacritics 2`, turn the typed text into prefix terms (`"pgbounc"*`), and fall back to `LIKE` when the query contains CJK characters or is under 3 characters. Revisit trigram only if middle-of-word matching turns out to matter. Its ~3× index is the cost.

[inferred] Quote each typed word before adding `*` (`"c++"*`, `"node:sqlite"*`), so FTS5's query syntax (`AND`, `NEAR`, `-`, `:`) never breaks or reinterprets what the user typed.

## 3. Cost on realistic data [ran]

**Data.** `gen.mjs` makes 2,000 Trees × 50 Turns = 100,000 Turns, alternating Prompt and Reply. Lengths are random around 300 characters for a Prompt and 2,500 for a Reply. Words are drawn Zipf-style from common English plus `/usr/share/dict/words`, and 5% of Turns get a French, German, Japanese, Chinese or Russian sentence. Total: **142 MB of text**, stored in a plain table taking 207 MB.

**Check on real text.** `real-ratio.mjs` indexed 2.8 MB of real conversation text (2,120 messages from local Claude Code transcripts; only sizes were kept). Ratios: `unicode61` 44%, `porter` 41%, `trigram` 261%. The synthetic ratios (44% / 42% / 299%) are close, so the numbers below should transfer.

**Results.** External-content FTS5 table (the index only; the text stays in its own table). Medians of 5 runs; `node:sqlite` first, then better-sqlite3:

| | `unicode61 rd2` | `porter` | `trigram rd1` |
| --- | --- | --- | --- |
| Index size | **62 MB (44%)** | 60 MB (42%) | **425 MB (299%)** |
| Full build ('rebuild') | 5.1 s / 4.4 s | 5.4 s / 4.8 s | 24.8 s / 22.4 s |
| 'optimize' (merge segments) | 0.9 s / 0.7 s | 0.9 s / 0.7 s | 4.7 s / 4.2 s |
| Rare word, top 50 ranked + snippets | 0.4 ms / 0.3 ms | 0.7 ms | 1.2 ms (`"pgbounc"`) |
| Two words, 8k matches | 9.7 ms / 7.8 ms | 9.6 ms | 36 ms / 28 ms |
| Short prefix `fu*`, 40k matches | 41 ms / 35 ms | 41 ms | — |
| "the" (in 99% of Turns) | 109 ms / 84 ms | 101 ms | 109 ms / 86 ms |
| Index one finished Reply (own transaction) | **0.14 ms** | 0.15 ms | 0.43 ms |
| Delete a 50-Turn Tree with its index entries | 3.9 ms | 4.6 ms | 4.7 ms |
| `integrity-check` | 1.4 s | 1.8 s | 6.4 s |

- No index at all (`LIKE '%postgres%'`): 171 ms / 195 ms per query.
- Performance does not separate the two drivers.
- [inferred] For a ⌘K palette that queries on each keystroke, slow cases are one- and two-letter prefixes and very common words. Wait for 2+ characters, debounce ~100 ms, and `LIMIT` the query (50 matches, grouped by Tree in JS) to keep it under ~100 ms at this size.

### When to index [inferred, from #11's write plan]

- **Prompt:** when it is submitted.
- **Reply:** once, when it reaches `complete`, `stopped`, `failed` (with partial text) or `interrupted`, in the same transaction as that final status write. Not during streaming: the ~1 s partial-text flush would re-index the same row dozens of times.
- **Title:** when the AI writes one or the user renames.

### Keeping it in sync [ran]

The test schema in [`full-text-search/drizzle/`](full-text-search/drizzle/) is:

- `search_docs(rowid INTEGER PRIMARY KEY, turn_id UNIQUE REFERENCES … ON DELETE CASCADE, tree_id, body)`, holding the extracted plain text;
- an external-content FTS5 table over it;
- three triggers (insert, delete, update) that copy changes into the index. This is SQLite's documented pattern. [docs](https://www.sqlite.org/fts5.html#external_content_tables)

Results:

- **Deletes:** deleting a Tree cascaded through `prompts` to `search_docs`, and the delete trigger removed the entry from the index. `integrity-check` passed. [ran] Deleting a Prompt and everything below it works the same way, since the cascade fires the triggers.
- **Restores** from an Archive are inserts, so the insert trigger indexes them. After a large restore, `INSERT INTO search_fts(search_fts) VALUES('optimize')` merges the index (~1 s at 100k Turns).
- **Repair:** `'rebuild'` regenerates the whole index from `search_docs` in ~5 s at 100k Turns. It is cheap enough to run after any migration that touches search, or if `integrity-check` fails.
- **Use an explicit `INTEGER PRIMARY KEY` for the index's row id**, not the hidden rowid of a table with UUID keys. SQLite may renumber hidden rowids on `VACUUM` ([docs](https://www.sqlite.org/lang_vacuum.html)), which would silently point index entries at the wrong Turns.
- **Why a separate `search_docs` table:** Reply content is stored as ordered JSON parts (#11). The index needs the plain visible text, which also makes snippets readable. It costs another copy of the text (~1× text) on top of the 44% index. [inferred] A contentless index (`content=''`) would avoid the copy, but `snippet()` and `highlight()` need the text, since a contentless table returns NULL for every column. [docs](https://www.sqlite.org/fts5.html#contentless_tables)

### Drizzle and migrations [ran] [docs]

- Drizzle's schema has no virtual tables. The feature request [drizzle-orm#2046](https://github.com/drizzle-team/drizzle-orm/issues/2046) ("sqlite CREATE VIRTUAL TABLE…") is open.
- `drizzle-kit generate --custom --name search_fts` creates an empty `migration.sql` for "DDL changes that Drizzle Kit doesn't support yet" [docs](https://orm.drizzle.team/docs/kit-custom-migrations). The `CREATE VIRTUAL TABLE` and `CREATE TRIGGER` statements, separated by `--> statement-breakpoint`, applied cleanly through `migrate()` from `drizzle-orm/node-sqlite/migrator` (1.0.0-rc.4), with the ADR 0003 foreign-key guard around it. [ran]
- Later `drizzle-kit generate` runs ignore the FTS table, because they diff the TS schema, not the database. [ran]
- **Gotcha (reproduced):** a later schema change made drizzle-kit rebuild `search_docs` (create `__new_search_docs`, copy, `DROP TABLE`, rename). `DROP TABLE` drops the table's triggers, so afterwards **no triggers existed**. The index kept answering, and `integrity-check` still passed, but future deletes would leave stale entries.
  - The rowid survived the rebuild only because it is an explicit column that Drizzle copies.
  - Fix: after every `migrate()`, have app code run `CREATE TRIGGER IF NOT EXISTS …` for the three triggers. Alternatively, drop triggers entirely and write `search_docs` and the index from the same app function that saves Turns. Either belongs in the ADR 0003 startup sequence.
- [docs] Drizzle Studio errored when opening FTS5's shadow tables ([drizzle-orm#3235](https://github.com/drizzle-team/drizzle-orm/issues/3235), closed 2026-08-18). This affects dev tooling only.

## 4. What to index

| Content | Index? | Why |
| --- | --- | --- |
| Prompt text | Yes | Core |
| Reply visible text (text parts) | Yes | Core; opening a result lands on this Turn |
| Tree title | Yes, in its own small FTS table (or a `title` column weighted higher via `bm25(fts, 10.0, 1.0)`) | Notion weighs titles more than content [docs]; titles also drive the title-only filter |
| Attachment file names | Yes, appended to the Prompt's row or as a column | Cheap; users remember "the PDF I sent" |
| Thinking | No | Not stored: display-only, gone after the Reply (#11) |
| Tool calls and tool results | No (v1) | Large and noisy (file contents, command output, search results). They would swamp the ranking and grow the index several times over [inferred]. Tool *names* or web-search queries could be added later as a low-weight column |
| Subagent work | No | Not a Turn, and it belongs to its Reply (CONTEXT). The Reply's own text carries the result |
| Workspace file contents | No | Ruled out by the ticket |
| System prompt | No | Shared standing instructions; would match every Tree using it |

## 5. Notion's search, and others for contrast

**Notion** ([Search help page](https://www.notion.com/help/search)) [docs]:

- **Opening:** ⌘P, or ⌘K when not editing a block.
- **Empty state:** **recently visited pages** with timestamps, not customisable.
- **Ranking:** the default sort, "Best matches", ranks recently edited pages higher and weighs **titles more than page content**. Some results carry badges ("Most viewed", "Popular this week").
- **Filters:**
  - **Title only**: "Any content inside of a page won't be considered".
  - **Created by**.
  - **Teamspace** (paid plans).
  - **In**: limits to chosen pages and their subpages.
  - **Date**: Today, Last 7 days, Last 30 days, or a custom range.
- **Sorts:** Best matches, Last edited (newest or oldest), Created (newest or oldest).
- **Not searched:** comments, discussions, select property values, @mentions of people and pages.
- **Keyboard:** ⌘-click opens a result in a new tab. In the desktop app, ⌘L copies a result's link. ⌘F finds text within a page.
- **AI:** "Search all sources with AI" opens a full results page with source, title and author filters.
- **Not documented:** snippet format, match highlighting, and whether opening a result scrolls to the match. Settle these in the prototype, not from Notion.

**Claude.ai** ([help](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)) [docs]: "Search past chats" is something you ask Claude to do, inside a conversation. It runs as a retrieval tool, and the answer cites past chats with links to them. Jumping to a specific message is not documented.

**ChatGPT** [docs, read via search-engine summaries because help.openai.com refused direct fetches]:

- ⌘K search matches chat titles and message text ([help](https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt)), and an older version of the article said only exact matches are supported.
- The July 2026 release notes added projects, images and documents with content-type filters. "Selecting a result opens the chat, project, or file directly" ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).
- Snippets and jumping to the matching message are not documented.

**VS Code Quick Open** (⌘P) [docs/source]:

- **Empty state:** recently opened files, and pressing ⌘P again cycles through them ([tips](https://code.visualstudio.com/docs/getstarted/tips-and-tricks)). The setting `search.quickOpen.includeHistory` puts them under a "recently opened" separator.
- **Fuzzy scorer** ([`fuzzyScorer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/fuzzyScorer.ts)): the query's characters must appear in order. Bonuses go to consecutive runs, start of string, after `/` or `_-. `, and camelCase humps. A prefix match on the file name ranks above other matches, and shorter names win ties.
- **Query parsing:** spaces split the query into parts that must all match, and quotes require a contiguous match.
- **Highlighting:** matched characters are highlighted.
- This suits short names (titles), not long Turn text.

**Takeaways for the prototype** [inferred]:

- Empty state: recent Trees.
- Matches in titles rank above matches in Turn text. Among text matches, combine BM25 with recency.
- Offer a title-only toggle, plus Provider and date filters, and sort by last active or created.
- Bold the matched words in snippets.
- Open the Tree at the Turn with the match highlighted. None of the references documents this step, so it is ours to design.
- For titles alone, VS Code-style fuzzy matching in JS is cheap: 2,000 titles easily fit in memory.

## 6. Meaning-based (semantic) search

Facts only; scope is decided later.

- **No embeddings through a subscription.**
  - "Anthropic does not offer its own embedding model." Its docs point to Voyage AI, which needs its own API key ([docs](https://platform.claude.com/docs/en/build-with-claude/embeddings)).
  - Claude and ChatGPT plans don't include API usage ([Claude](https://support.claude.com/en/articles/9876003), [OpenAI](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)).
  - Nothing documents an embeddings endpoint reachable with subscription sign-in.
  - [inferred] Asking the Model itself to judge relevance (as Claude.ai's "search past chats" does) is possible through the Agent SDK. It would spend the user's plan on every search, and the Model would need the candidate text passed to it.
- **Local model.**
  - `@huggingface/transformers` (transformers.js) runs ONNX models in Node, and can run fully offline with `env.allowRemoteModels = false` ([docs](https://huggingface.co/docs/transformers.js/tutorials/node)). Electron is not mentioned.
  - Sizes, all 384-dimension vectors ([HF](https://huggingface.co/Xenova/all-MiniLM-L6-v2)):
    - `Xenova/all-MiniLM-L6-v2`: 23 MB quantized / 90 MB fp32, English, reads at most 256 word pieces.
    - `bge-small-en-v1.5`: 34 / 133 MB.
    - `multilingual-e5-small`: 118 / 470 MB.
  - A Reply longer than the model's window must be split into chunks.
- **Vector storage.**
  - [`sqlite-vec`](https://github.com/asg017/sqlite-vec) (npm 0.1.9, pre-v1, prebuilt for macOS, Linux and Windows x64) is a loadable extension.
  - It works with better-sqlite3, and with `node:sqlite` via `new DatabaseSync(path, { allowExtension: true })` ([sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html)). `allowExtension` cannot be turned on after opening ([Node docs](https://nodejs.org/api/sqlite.html)).
  - Raw size at 100k Turns × 384 dimensions: ~154 MB float32, ~38 MB int8, ~5 MB binary, and more if Replies are split into chunks.
- **Untested here:** model load time and memory in Electron, embedding throughput (backfilling 100k Turns), and loading sqlite-vec from a packaged, signed app.

## Scripts

Everything is in [`full-text-search/`](full-text-search/). The scripts expect a scratch folder with `electron@44`, `better-sqlite3@13`, `minisearch`, `flexsearch` and `drizzle-orm@rc`/`drizzle-kit@rc` installed (`npm i --legacy-peer-deps` for Drizzle rc). Some paths are hard-coded to `/tmp/fts-scratch`.

| Script | What it tests | Run with |
| --- | --- | --- |
| `probe.mjs` | FTS5 availability and tokenizer behaviour | `ELECTRON_RUN_AS_NODE=1 npx electron probe.mjs` |
| `gen.mjs` + `bench.mjs` | Cost at 100k Turns | `… bench.mjs node:sqlite` or `… bench.mjs better-sqlite3` |
| `real-ratio.mjs` | Index-size ratio on real text | `… real-ratio.mjs` |
| `js-index.mjs` | MiniSearch and FlexSearch | `… --expose-gc js-index.mjs minisearch` |
| `drizzle/` | Custom migration, cascade delete, and the dropped-trigger gotcha | `run.mjs seed`, then `delete`, then edit the schema, `drizzle-kit generate`, and `run.mjs check` |

## Unverified / open

- Windows and Linux builds. Everything ran unpackaged on macOS arm64. The compile flags come from the shared source build, so FTS5 should be present everywhere.
- Whether search queries in the main process cause visible UI stalls when they run alongside streaming Replies. Each query took at most ~110 ms, and the database is synchronous.
- How snippets and highlights look on Markdown and code in Replies. The visible text would be indexed with its Markdown syntax, so `snippet()` may cut through a code fence.
- CJK quality beyond the `LIKE` fallback. ICU tokenizers are not compiled in.
