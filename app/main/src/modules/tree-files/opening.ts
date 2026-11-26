import type {Desktop} from './desktop'
import type {TreeFilePreview} from '@uz/contract/tree-files'

import path from 'node:path'

import {LINK_REFUSED} from './location'

export type OpenWith = 'default-app' | 'browser' | 'editor' | 'quick-look'

export interface Openable {
  /** Inside the Tree's files. */
  path: string
  onDisk: boolean
  preview: TreeFilePreview
  executable: boolean
  link: boolean
  /** The file in the Tree's folder when `onDisk`, else a read-only copy. */
  locate: () => Promise<{file: string; executable: boolean}>
}

const PROGRAM_REFUSED =
  'That file is marked as a program, which Unimatrix Zero never opens.'

const NOT_IN_FOLDER =
  'At this Turn the file isn’t in the Tree’s folder, so it can only be opened as a copy.'

function refusal(desktop: Desktop, how: OpenWith, openable: Openable) {
  if (openable.link) return LINK_REFUSED

  const runs = how === 'default-app' || how === 'browser'

  if (runs && openable.executable) return PROGRAM_REFUSED

  if (how === 'browser' && openable.preview !== 'html') {
    return 'Only an HTML file opens in the browser.'
  }

  // A change to a copy of an earlier Turn's file would be lost.
  if (how === 'editor' && !openable.onDisk) return NOT_IN_FOLDER

  if (how === 'editor' && desktop.editor() === null) {
    return 'No editor was found on this computer.'
  }

  if (how === 'quick-look' && desktop.platform !== 'darwin') {
    return 'Quick Look is on macOS only.'
  }

  return null
}

export async function openWith(
  desktop: Desktop,
  openable: Openable,
  how: OpenWith
) {
  const refused = refusal(desktop, how, openable)

  if (refused) throw new Error(refused)

  const {file, executable} = await openable.locate()

  if ((how === 'default-app' || how === 'browser') && executable) {
    throw new Error(PROGRAM_REFUSED)
  }

  switch (how) {
    case 'default-app':
      return desktop.openWithDefaultApp(file)
    case 'browser':
      return desktop.openInBrowser(file)
    case 'editor':
      return desktop.openInEditor(file)
    case 'quick-look':
      return desktop.quickLook(file, path.posix.basename(openable.path))
  }
}

export async function reveal(desktop: Desktop, openable: Openable) {
  if (openable.link) throw new Error(LINK_REFUSED)

  if (!openable.onDisk) {
    throw new Error(
      'At this Turn the file isn’t in the Tree’s folder. Save a copy to keep it.'
    )
  }

  desktop.reveal((await openable.locate()).file)
}
