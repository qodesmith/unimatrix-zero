import {useEffect, useLayoutEffect, useRef} from 'react'

import {textSizeFor} from '../text-size'
import {useSettings, useUpdateSettings} from '../use-settings'

/**
 * Sets the root font size, which every `rem` of text follows, and changes it
 * on ⌘+, ⌘− and ⌘0.
 */
export function TextSize() {
  const {textSize} = useSettings()
  const update = useUpdateSettings()
  // A held key repeats faster than a render, so each press steps from the last.
  const current = useRef(textSize)

  useLayoutEffect(() => {
    current.current = textSize
    document.documentElement.style.fontSize = `${textSize}px`
  }, [textSize])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const next = textSizeFor(event, current.current)

      if (next === null) return
      event.preventDefault()

      if (next === current.current) return
      current.current = next
      void update({textSize: next})
    }

    globalThis.addEventListener('keydown', onKeyDown)

    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [update])

  return null
}
