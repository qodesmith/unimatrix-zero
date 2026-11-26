/** What the computer does with a file: Electron's in the app, a fake in tests. */
export interface Desktop {
  platform: NodeJS.Platform
  /** The name of the editor found on this computer, looked for once. */
  editor: () => string | null
  /** Each rejects with a message the user can read. */
  openWithDefaultApp: (file: string) => Promise<void>
  openInBrowser: (file: string) => Promise<void>
  openInEditor: (file: string) => Promise<void>
  /** Quick Look, on macOS only. */
  quickLook: (file: string, name: string) => void
  reveal: (file: string) => void
  /** Null when the user cancels. */
  pickSaveFile: (defaultName: string) => Promise<string | null>
  pickFolder: () => Promise<string | null>
  /** A `data:image/` URL, or null where the OS has none. */
  thumbnail: (file: string) => Promise<string | null>
}
