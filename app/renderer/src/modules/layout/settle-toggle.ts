/**
 * Removes a panel group's `data-toggling` once its panels' transitions end,
 * waiting a frame so they have started. Returns a cancel.
 */
export function settleToggle(group: HTMLElement | null) {
  let current = true

  async function settle() {
    const animations = [...(group?.children ?? [])].flatMap(child =>
      child.getAnimations()
    )

    await Promise.allSettled(
      animations.map(async animation => animation.finished)
    )

    if (current) group?.removeAttribute('data-toggling')
  }

  const frame = requestAnimationFrame(() => void settle())

  return () => {
    current = false
    cancelAnimationFrame(frame)
  }
}
