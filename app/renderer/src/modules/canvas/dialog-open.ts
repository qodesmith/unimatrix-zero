/**
 * An open dialog, which Base UI marks `data-open`, owns Esc over the canvas.
 * The slideout shares Esc with the canvas, so it doesn't count.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open]:not([data-slideout]), [role="alertdialog"][data-open]'
    ) !== null
  )
}
