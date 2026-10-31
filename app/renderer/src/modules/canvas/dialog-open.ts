/**
 * An open dialog, such as the Settings Sheet or the confirmation to delete a
 * Prompt, owns Esc: the canvas's own Esc handlers leave it alone. Base UI marks
 * an open dialog or alert dialog `data-open`.
 */
export function dialogOpen() {
  return (
    document.querySelector(
      '[role="dialog"][data-open], [role="alertdialog"][data-open]'
    ) !== null
  )
}
