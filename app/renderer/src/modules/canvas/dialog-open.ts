/**
 * An open dialog owns Esc, so the canvas's Esc handlers yield to it. Base UI
 * marks one `data-open`.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open], [role="alertdialog"][data-open]'
    ) !== null
  )
}
