/**
 * An open dialog, which Base UI marks `data-open`, owns Esc over the canvas.
 * A file's preview is one. The slideout shares Esc with the canvas, so it
 * doesn't count.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open]:not([data-slideout]), [role="alertdialog"][data-open]'
    ) !== null
  )
}

/** A file's preview takes Esc before the slideout under it. */
export function filePreviewOpen() {
  return document.querySelector('[data-file-preview][data-open]') !== null
}
