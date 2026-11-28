import type {FileAt} from './tree-files-store'
import type {TreeFile} from '@uz/contract/tree-files'

import {bridge} from '#modules/bridge/main'
import {useQuery} from '@tanstack/react-query'
import {treeFileUrl} from '@uz/contract/tree-files'
import {use, useEffect} from 'react'

import {PdfOpener} from './pdf'
import {treeFilesKey} from './tree-files-store'

export const TEXT_PREVIEW_BYTES = 256 * 1024

function fileKey({treeId, replyId}: FileAt, file: TreeFile) {
  return [...treeFilesKey(treeId, replyId), 'file', file.id]
}

export function useTreeFileDetails(at: FileAt, file: TreeFile) {
  return useQuery({
    queryKey: fileKey(at, file),
    queryFn: async () => {
      const outcome = await bridge().send({
        type: 'tree-file.describe',
        fileId: file.id,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      return outcome.value
    },
  })
}

export interface TextStart {
  text: string
  shownSize: number
}

async function readStart(file: TreeFile): Promise<TextStart> {
  const response = await fetch(treeFileUrl(file.id), {
    headers: {Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}`},
  })

  if (!response.ok) throw new Error('The file could not be read.')

  const bytes = new Uint8Array(await response.arrayBuffer()).slice(
    0,
    TEXT_PREVIEW_BYTES
  )

  const cut = file.size > bytes.length
  const end = cut ? bytes.lastIndexOf(0x0a) : -1
  const shown = end === -1 ? bytes : bytes.subarray(0, end)

  return {text: new TextDecoder().decode(shown), shownSize: shown.length}
}

export function useTextStart(at: FileAt, file: TreeFile) {
  return useQuery({
    queryKey: [...fileKey(at, file), 'start'],
    queryFn: async () => readStart(file),
  })
}

export function useThumbnail(at: FileAt, file: TreeFile) {
  return useQuery({
    queryKey: [...fileKey(at, file), 'thumbnail'],
    queryFn: async () => {
      const outcome = await bridge().send({
        type: 'tree-file.thumbnail',
        fileId: file.id,
      })

      return outcome.ok ? outcome.value.dataUrl : null
    },
  })
}

export function usePdf(file: TreeFile) {
  const openPdf = use(PdfOpener)

  const query = useQuery({
    queryKey: ['tree-file-pdf', file.id],
    queryFn: async () => openPdf(treeFileUrl(file.id)),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const pdf = query.data

  useEffect(() => () => pdf?.close(), [pdf])

  return query
}
