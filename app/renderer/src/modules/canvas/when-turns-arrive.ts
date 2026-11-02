function turnSlidesIn(pane: HTMLElement) {
  return [...pane.querySelectorAll('.react-flow__node')].flatMap(node =>
    node
      .getAnimations()
      .filter(
        animation =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === 'transform'
      )
  )
}

/**
 * Calls `onArrived` once no Turn in the pane is sliding. Returns a cancel.
 * React Flow cancels and restarts the slides as it measures the Turns, so it
 * looks again after each round ends, until a frame passes with none.
 */
export function whenTurnsArrive(pane: HTMLElement, onArrived: () => void) {
  let current = true
  let frame = 0

  async function nextFrame() {
    return new Promise<void>(resolve => {
      frame = requestAnimationFrame(() => resolve())
    })
  }

  async function settle(): Promise<void> {
    await nextFrame()

    if (!current) return

    const slides = turnSlidesIn(pane)

    if (slides.length === 0) {
      onArrived()

      return
    }

    await Promise.allSettled(slides.map(async slide => slide.finished))

    await settle()
  }

  void settle()

  return () => {
    current = false
    cancelAnimationFrame(frame)
  }
}
