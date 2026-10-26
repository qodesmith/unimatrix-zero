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

function isBundledTheme(name: string): name is BundledTheme {
  return Object.hasOwn(bundledThemes, name)
}

function bundledTheme(name: string): BundledTheme {
  if (!isBundledTheme(name)) {
    throw new Error(`Shiki ships no theme named "${name}"`)
  }

  return name
}

/** The Theme's Shiki themes, light then dark. */
function codeThemes(): [BundledTheme, BundledTheme] {
  const [light, dark] = shikiThemes()

  return [bundledTheme(light), bundledTheme(dark)]
}

/**
 * Streamdown's rehype plugins minus `rehype-raw`, so HTML stays text
 * (ADR 0014).
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
 * `trust: false` is the only gate on KaTeX's output (ADR 0014): Streamdown
 * runs the math plugin after the rehype plugins above, so the sanitizer never
 * sees it.
 * remark-math's default accepts a single `$`, turning "$5 and $10" into math.
 */
const math: MathPlugin = {
  name: 'katex',
  type: 'math',
  remarkPlugin: [remarkMath, {singleDollarTextMath: false}],
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

export function loadedMermaid() {
  return mermaid
}

/** A flowchart node drawn as a picture: `A@{ img: "https://…" }`. */
const IMAGE_NODE = /@\{[^}]*\bimg\s*:/u

/**
 * Mermaid's image shape fetches its URL as soon as the diagram draws, and
 * strict mode does not stop it. A Reply never reaches the network on its own
 * (ADR 0014), so such a diagram is an error instead.
 */
function withoutImages(plugin: DiagramPlugin): DiagramPlugin {
  return {
    ...plugin,
    getMermaid(config) {
      const instance = plugin.getMermaid(config)

      return {
        ...instance,
        async render(id, source) {
          if (IMAGE_NODE.test(source)) {
            throw new Error('a diagram cannot show a remote image')
          }

          return instance.render(id, source)
        },
      }
    },
  }
}

/** Loads the Mermaid bundle once, the first time a Reply contains a diagram. */
export async function loadMermaid(): Promise<DiagramPlugin> {
  loading ??= import('@streamdown/mermaid').then(({createMermaidPlugin}) => {
    mermaid = withoutImages(
      createMermaidPlugin({config: {securityLevel: 'strict'}})
    )

    return mermaid
  })

  return loading
}
