import type {Desktop} from './desktop'
import type {TreeFileOpenWith} from '@uz/contract/commands'
import type {TreeFileDetails} from '@uz/contract/tree-files'

import path from 'node:path'

import {LINK_REFUSED} from './location'

export interface Openable {
  /** Inside the Tree's files. */
  path: string
  onDisk: boolean
  preview: TreeFileDetails['preview']
  notOpened: TreeFileDetails['notOpened']
  link: boolean
  /** The file in the Tree's folder when `onDisk`, else a read-only copy. */
  locate: () => Promise<{file: string; executable: boolean}>
}

const PROGRAM_REFUSED =
  'That file is marked as a program, which Unimatrix Zero never opens.'

const NOT_A_DOCUMENT_REFUSED =
  'Unimatrix Zero opens only documents, and that kind of file can run as a program.'

const NOT_IN_FOLDER =
  'At this Turn the file isn’t in the Tree’s folder, so it can only be opened as a copy.'

/**
 * Its app and the browser can run a program; the editor and Quick Look never
 * do.
 */
function programRefusal(how: TreeFileOpenWith, program: boolean) {
  return (how === 'default-app' || how === 'browser') && program
    ? PROGRAM_REFUSED
    : null
}

function refusal(desktop: Desktop, how: TreeFileOpenWith, openable: Openable) {
  if (openable.link) return LINK_REFUSED

  const asProgram = programRefusal(how, openable.notOpened === 'program')

  if (asProgram) return asProgram

  if (how === 'default-app' && openable.notOpened !== null) {
    return NOT_A_DOCUMENT_REFUSED
  }

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
  how: TreeFileOpenWith
) {
  const refused = refusal(desktop, how, openable)

  if (refused) throw new Error(refused)

  const {file, executable} = await openable.locate()

  const asProgram = programRefusal(how, executable)

  if (asProgram) throw new Error(asProgram)

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
