/**
 * An open dialog (Base UI's `data-open`) owns Esc; the slideout shares it, so
 * it doesn't count.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open]:not([data-slideout]), [role="alertdialog"][data-open]'
    ) !== null
  )
}

export function filePreviewOpen() {
  return document.querySelector('[data-file-preview][data-open]') !== null
}
