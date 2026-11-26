import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {LucideIcon} from 'lucide-react'

import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileVideoIcon,
  LinkIcon,
} from 'lucide-react'

export function baseName(path: string) {
  return path.split('/').at(-1) ?? path
}

/** Lowercase, without the dot; '' for none. */
export function extensionOf(path: string) {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')

  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function typeName(path: string) {
  const extension = extensionOf(path)

  return extension === '' ? 'File' : `${extension.toUpperCase()} file`
}

const BY_PREVIEW = {
  image: FileImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  pdf: FileTextIcon,
  markdown: FileTextIcon,
  csv: FileSpreadsheetIcon,
  html: FileCodeIcon,
  text: FileCodeIcon,
  other: null,
} satisfies Record<TreeFileDetails['preview'], LucideIcon | null>

/** For the files the app doesn't show itself. */
const BY_EXTENSION = new Map([
  ['zip', FileArchiveIcon],
  ['gz', FileArchiveIcon],
  ['tar', FileArchiveIcon],
  ['7z', FileArchiveIcon],
  ['xlsx', FileSpreadsheetIcon],
  ['xls', FileSpreadsheetIcon],
  ['numbers', FileSpreadsheetIcon],
  ['docx', FileTextIcon],
  ['doc', FileTextIcon],
  ['pages', FileTextIcon],
  ['rtf', FileTextIcon],
])

/** The app's own icons: no OS icon reaches the renderer. */
export function iconOf(details: TreeFileDetails): LucideIcon {
  if (details.link) return LinkIcon

  if (details.notOpened === 'program') return FileTerminalIcon

  return (
    BY_PREVIEW[details.preview] ??
    BY_EXTENSION.get(extensionOf(details.path)) ??
    FileIcon
  )
}
