/**
 * An open dialog owns Esc, so the canvas's Esc handlers yield to it. Base UI
 * marks one `data-open`. The slideout is a dialog that shares Esc with the
 * canvas, so it doesn't count.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open]:not([data-slideout]), [role="alertdialog"][data-open]'
    ) !== null
  )
}
