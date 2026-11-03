import type {GrammarState, HighlighterCore} from 'shiki/core'

import {createHighlighterCore} from 'shiki/core'
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript'

// Add the languages you need. Each one loads the first time it is used.
const languages = {
  bash: async () => import('shiki/langs/shellscript.mjs'),
  css: async () => import('shiki/langs/css.mjs'),
  diff: async () => import('shiki/langs/diff.mjs'),
  html: async () => import('shiki/langs/html.mjs'),
  javascript: async () => import('shiki/langs/javascript.mjs'),
  json: async () => import('shiki/langs/json.mjs'),
  jsx: async () => import('shiki/langs/jsx.mjs'),
  markdown: async () => import('shiki/langs/markdown.mjs'),
  python: async () => import('shiki/langs/python.mjs'),
  sql: async () => import('shiki/langs/sql.mjs'),
  tsx: async () => import('shiki/langs/tsx.mjs'),
  typescript: async () => import('shiki/langs/typescript.mjs'),
  yaml: async () => import('shiki/langs/yaml.mjs'),
}

const aliases = new Map<string, keyof typeof languages>([
  ['js', 'javascript'],
  ['md', 'markdown'],
  ['py', 'python'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['shellscript', 'bash'],
  ['ts', 'typescript'],
  ['yml', 'yaml'],
  ['zsh', 'bash'],
])

function isListedLanguage(name: string): name is keyof typeof languages {
  return Object.hasOwn(languages, name)
}

let highlighter: Promise<HighlighterCore> | undefined

async function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({forgiving: true}),
  })

  return highlighter
}

function getLanguage(language: string) {
  const name = language.toLowerCase()

  if (name === 'ansi') {
    return name
  }

  if (isListedLanguage(name)) {
    return name
  }

  return aliases.get(name) ?? null
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language)

  if (!lang) {
    return null
  }

  const shiki = await getHighlighter()

  if (lang !== 'ansi' && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang])
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const options = {
        lang,
        themes: {light: 'github-light', dark: 'github-dark'},
        defaultColor: false,
        grammarState: state,
      } as const

      function tokenize(text: string) {
        return shiki.codeToTokens(text, options).tokens
      }

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens =
        lang === 'ansi'
          ? code.split('\n').flatMap(line => tokenize(line))
          : tokenize(code)

      return {
        lines: tokens.map(line =>
          line.map(token => (
            <span
              key={token.offset}
              style={token.htmlStyle}
              className="text-(--shiki-light) dark:text-(--shiki-dark)"
            >
              {token.content}
            </span>
          ))
        ),
        state: shiki.getLastGrammarState(tokens),
      }
    },
  }
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const loaded = await loadHighlighter(language)

  return loaded ? loaded.highlight(code).lines : null
}
