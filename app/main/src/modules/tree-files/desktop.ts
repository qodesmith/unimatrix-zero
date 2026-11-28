/** What the computer does with a file: Electron's in the app, a fake in tests. */
export interface Desktop {
  platform: NodeJS.Platform
  editor: () => string | null
  /** Each rejects with a message the user can read. */
  openWithDefaultApp: (file: string) => Promise<void>
  openInBrowser: (file: string) => Promise<void>
  openInEditor: (file: string) => Promise<void>
  quickLook: (file: string, name: string) => void
  reveal: (file: string) => void
  /** Null when the user cancels. */
  pickSaveFile: (defaultName: string) => Promise<string | null>
  pickFolder: () => Promise<string | null>
  /** A `data:image/` URL, or null where the OS has none. */
  thumbnail: (file: string) => Promise<string | null>
}
