import {useCallback, useMemo, useRef, useState} from 'react'

/**
 * The viewport moves the canvas makes itself. Each move cuts short the one
 * before it, and React Flow never resolves a glide cut short, so only the
 * latest glide can end the motion.
 */
export function useMotion() {
  const latest = useRef(0)
  const [moving, setMoving] = useState(false)

  const glide = useCallback(async (run: () => Promise<boolean>) => {
    const sequence = ++latest.current
    setMoving(true)
    await run()

    if (latest.current === sequence) setMoving(false)
  }, [])

  /** The glide in flight was ended by a move with no duration, or by the user. */
  const stop = useCallback(() => {
    latest.current += 1
    setMoving(false)
  }, [])

  const jump = useCallback(
    (run: () => Promise<boolean>) => {
      stop()
      void run()
    },
    [stop]
  )

  // Apart from `moving`: effects depend on these and must not rerun as it changes.
  const moves = useMemo(() => ({glide, jump, stop}), [glide, jump, stop])

  return {moving, moves}
}

export type Moves = ReturnType<typeof useMotion>['moves']
