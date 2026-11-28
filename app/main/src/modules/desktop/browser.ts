export type RunProgram = (program: string, args: string[]) => Promise<string>

/** A desktop file's name, which never starts like an option or holds a path. */
const DESKTOP_ID = /^\w[\w.-]*\.desktop$/u

const NO_BROWSER =
  'Your default browser couldn’t be found or started, so the file wasn’t opened.'

async function defaultBrowser(run: RunProgram) {
  try {
    const id = (
      await run('xdg-settings', ['get', 'default-web-browser'])
    ).trim()

    return DESKTOP_ID.test(id) ? id : null
  } catch {
    return null
  }
}

/** `xdg-open` would open whatever app handles HTML, not the browser. */
export async function openInLinuxBrowser(run: RunProgram, file: string) {
  const browser = await defaultBrowser(run)

  if (browser === null) throw new Error(NO_BROWSER)

  try {
    await run('gtk-launch', [browser, file])
  } catch {
    throw new Error(NO_BROWSER)
  }
}
