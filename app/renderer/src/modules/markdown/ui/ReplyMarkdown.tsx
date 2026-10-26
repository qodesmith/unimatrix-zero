import type {Components, DiagramPlugin, MermaidOptions} from 'streamdown'

import 'katex/dist/katex.min.css'

import {useEffect, useState} from 'react'
import {Streamdown} from 'streamdown'

import {
  hasDiagram,
  loadMermaid,
  loadedMermaid,
  plugins,
  rehypePlugins,
} from '../plugins'
import {DiagramError} from './DiagramError'
import {RemoteImage} from './RemoteImage'

const components: Components = {img: RemoteImage}
const mermaidOptions: MermaidOptions = {errorComponent: DiagramError}

/** The Mermaid plugin, loading it the first time a Reply needs it. */
function useMermaid(needed: boolean): DiagramPlugin | null {
  const [mermaid, setMermaid] = useState(loadedMermaid)

  useEffect(() => {
    if (!needed || mermaid) return undefined

    let current = true

    async function load() {
      const loaded = await loadMermaid()

      if (current) setMermaid(loaded)
    }

    void load()

    return () => {
      current = false
    }
  }, [needed, mermaid])

  return mermaid
}

interface ReplyMarkdownProps {
  text: string
  /** Still being written: incomplete Markdown is closed as it renders. */
  streaming: boolean
}

/**
 * Never reaches the network on its own: links open through main's link rule,
 * and remote images are chips until clicked.
 */
export function ReplyMarkdown({text, streaming}: ReplyMarkdownProps) {
  const mermaid = useMermaid(hasDiagram(text))

  return (
    <Streamdown
      isAnimating={streaming}
      plugins={mermaid ? {...plugins, mermaid} : plugins}
      mermaid={mermaidOptions}
      rehypePlugins={rehypePlugins}
      components={components}
      linkSafety={{enabled: false}}
      className="flex flex-col gap-3 [&_pre]:text-xs"
    >
      {text}
    </Streamdown>
  )
}
