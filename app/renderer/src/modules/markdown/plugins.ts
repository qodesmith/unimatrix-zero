import type {BundledTheme} from 'shiki/themes'
import type {
  DiagramPlugin,
  MathPlugin,
  PluginConfig,
  StreamdownProps,
} from 'streamdown'

import {shikiThemes} from '#modules/theme/main'
import {createCodePlugin} from '@streamdown/code'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import {bundledThemes} from 'shiki/themes'
import {defaultRehypePlugins} from 'streamdown'

const FALLBACK_THEMES: [BundledTheme, BundledTheme] = [
  'github-light',
  'github-dark',
]

function isBundledTheme(name: string): name is BundledTheme {
  return Object.hasOwn(bundledThemes, name)
}

/** The Theme's Shiki themes, light then dark, when Shiki ships them. */
function codeThemes(): [BundledTheme, BundledTheme] {
  const [light, dark] = shikiThemes()

  return isBundledTheme(light) && isBundledTheme(dark)
    ? [light, dark]
    : FALLBACK_THEMES
}

/**
 * Streamdown's rehype pipeline without `rehype-raw`: the sanitizer and the
 * hardening pass stay, so HTML written into a Reply is text (ADR 0014).
 */
function withoutRawHtml(): NonNullable<StreamdownProps['rehypePlugins']> {
  const {sanitize, harden} = defaultRehypePlugins

  if (!sanitize || !harden) {
    throw new Error(
      'Streamdown no longer ships its sanitize and harden plugins'
    )
  }

  return [sanitize, harden]
}

export const rehypePlugins = withoutRawHtml()

/**
 * KaTeX in untrusted mode: `\url`, `\href`, `\includegraphics` and raw HTML
 * commands render as errors rather than markup (ADR 0014).
 */
const math: MathPlugin = {
  name: 'katex',
  type: 'math',
  remarkPlugin: remarkMath,
  rehypePlugin: [
    rehypeKatex,
    {trust: false, strict: 'ignore', errorColor: 'var(--destructive)'},
  ],
}

export const plugins: PluginConfig = {
  code: createCodePlugin({themes: codeThemes()}),
  math,
}

const DIAGRAM = /^[ \t]*(?:```|~~~)[ \t]*mermaid\b/mu

/** Whether the Markdown has a Mermaid fence, finished or not. */
export function hasDiagram(markdown: string) {
  return DIAGRAM.test(markdown)
}

let mermaid: DiagramPlugin | null = null
let loading: Promise<DiagramPlugin> | null = null

/** The Mermaid plugin once it has loaded, or null before the first load. */
export function loadedMermaid() {
  return mermaid
}

/**
 * Mermaid is the heaviest thing a Reply can show, so its bundle loads the
 * first time a Reply contains a diagram and never otherwise. Strict mode: no
 * click handlers, scripts or HTML labels in a diagram.
 */
export async function loadMermaid(): Promise<DiagramPlugin> {
  loading ??= import('@streamdown/mermaid').then(({createMermaidPlugin}) => {
    mermaid = createMermaidPlugin({config: {securityLevel: 'strict'}})

    return mermaid
  })

  return loading
}
