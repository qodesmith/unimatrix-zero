// Node gives custom schemes an opaque "null" origin, the same as about:blank
// and data:, so compare scheme and host rather than `origin`.
export function isAppUrl(target: string, appUrl: string): boolean {
  const url = URL.parse(target)
  const app = new URL(appUrl)

  return url !== null && url.protocol === app.protocol && url.host === app.host
}

interface Frame {
  url: string
}

interface IpcSender {
  senderFrame: Frame | null
  sender: {mainFrame: Frame}
}

/** The one trust check every IPC channel runs on its sender. */
export function isTopLevelAppFrame(event: IpcSender, appUrl: string): boolean {
  const frame = event.senderFrame

  return (
    frame !== null &&
    frame === event.sender.mainFrame &&
    isAppUrl(frame.url, appUrl)
  )
}
