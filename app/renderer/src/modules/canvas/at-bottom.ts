/** How close to the bottom still counts as reading the newest text, in px. */
const AT_BOTTOM = 24

export function atBottom({scrollHeight, scrollTop, clientHeight}: HTMLElement) {
  return scrollHeight - scrollTop - clientHeight < AT_BOTTOM
}
