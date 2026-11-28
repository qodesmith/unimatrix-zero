export interface Desktop {
  platform: NodeJS.Platform
  editor: () => string | null
  /** Each rejects with a message the user can read. */
  openWithDefaultApp: (file: string) => Promise<void>
  openInBrowser: (file: string) => Promise<void>
  openInEditor: (file: string) => Promise<void>
  quickLook: (file: string, name: string) => void
  reveal: (file: string) => void
  pickSaveFile: (defaultName: string) => Promise<string | null>
  pickFolder: () => Promise<string | null>
  thumbnail: (file: string) => Promise<string | null>
}
