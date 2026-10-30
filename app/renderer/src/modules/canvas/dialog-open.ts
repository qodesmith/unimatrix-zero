/**
 * An open dialog, such as the Settings Sheet over the canvas, owns Esc: the
 * canvas's own Esc handlers leave it alone. Base UI marks an open dialog
 * `data-open`.
 */
export function dialogOpen() {
  return document.querySelector('[role="dialog"][data-open]') !== null
}
