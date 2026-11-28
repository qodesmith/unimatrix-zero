// Custom schemes get an opaque "null" origin, so compare protocol and host.
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

export function isTopLevelAppFrame(event: IpcSender, appUrl: string): boolean {
  const frame = event.senderFrame

  return (
    frame !== null &&
    frame === event.sender.mainFrame &&
    isAppUrl(frame.url, appUrl)
  )
}
