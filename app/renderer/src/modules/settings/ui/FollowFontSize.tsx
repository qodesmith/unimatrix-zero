import {useEffect, useLayoutEffect, useRef} from 'react'

import {fontSizeFor} from '../font-size'
import {useSettings, useUpdateSettings} from '../use-settings'

/**
 * Sets the root font size, which every `rem` of text follows, and changes it
 * on ⌘+, ⌘− and ⌘0.
 */
export function FollowFontSize() {
  const {fontSize} = useSettings()
  const update = useUpdateSettings()
  // A held key repeats faster than a render, so each press steps from the last.
  const latestFontSize = useRef(fontSize)

  useLayoutEffect(() => {
    latestFontSize.current = fontSize
    document.documentElement.style.fontSize = `${fontSize}px`
  }, [fontSize])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const next = fontSizeFor(event, latestFontSize.current)

      if (next === null) return
      event.preventDefault()

      if (next === latestFontSize.current) return
      latestFontSize.current = next
      void update({fontSize: next})
    }

    globalThis.addEventListener('keydown', onKeyDown)

    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [update])

  return null
}
