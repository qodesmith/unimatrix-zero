import type {GitStatusEntry} from '@pierre/trees'
import type {TreeFile} from '@uz/contract/tree-files'
import type {MouseEvent} from 'react'

import {FileTree, useFileTree} from '@pierre/trees/react'
import {cn} from 'cn'
import {useEffect, useLayoutEffect, useRef} from 'react'

const GIT_STATUS = {
  created: 'added',
  edited: 'modified',
  deleted: 'deleted',
} as const

function gitStatusOf(files: readonly TreeFile[]): GitStatusEntry[] {
  return files.flatMap(({path, change}) =>
    change === null ? [] : [{path, status: GIT_STATUS[change]}]
  )
}

/** The file row a click landed in, through the tree's shadow root. */
function clickedFile(event: Event) {
  for (const target of event.composedPath()) {
    if (
      target instanceof HTMLElement &&
      target.dataset.itemPath !== undefined
    ) {
      return target.dataset.itemType === 'file' ? target.dataset.itemPath : null
    }
  }

  return null
}

interface FilesTreeProps {
  files: readonly TreeFile[]
  onOpen: (path: string) => void
}

/** View only: a row opens its file, and nothing in the tree changes a file. */
export function FilesTree({files, onOpen}: FilesTreeProps) {
  const opener = useRef(onOpen)

  useLayoutEffect(() => {
    opener.current = onOpen
  }, [onOpen])

  const {model} = useFileTree({
    paths: files.map(file => file.path),
    gitStatus: gitStatusOf(files),
    initialExpansion: 'open',
    density: 'compact',
    onSelectionChange: paths => {
      const path = paths.find(one => !one.endsWith('/'))

      if (path !== undefined) opener.current(path)
    },
  })

  const shown = useRef(files)

  useEffect(() => {
    if (shown.current === files) return

    shown.current = files
    model.resetPaths(files.map(file => file.path))
    model.setGitStatus(gitStatusOf(files))
  }, [model, files])

  return (
    <FileTree
      model={model}
      // The selected row isn't selected again, so a click reopens a closed preview.
      onClick={(event: MouseEvent<HTMLElement>) => {
        const path = clickedFile(event.nativeEvent)

        if (path !== null) opener.current(path)
      }}
      className={cn(
        'block h-full [color-scheme:inherit]',
        '[--trees-bg-override:var(--sidebar)] [--trees-fg-muted-override:var(--muted-foreground)] [--trees-fg-override:var(--sidebar-foreground)]',
        '[--trees-bg-muted-override:var(--sidebar-accent)] [--trees-selected-bg-override:var(--sidebar-accent)] [--trees-selected-fg-override:var(--sidebar-accent-foreground)]',
        '[--trees-accent-override:var(--sidebar-primary)] [--trees-focus-ring-color-override:var(--sidebar-ring)] [--trees-selected-focused-border-color-override:var(--sidebar-ring)]',
        '[--trees-border-color-override:var(--sidebar-border)] [--trees-font-family-override:var(--font)]',
        '[--trees-git-added-color-override:var(--success)] [--trees-git-deleted-color-override:var(--destructive)] [--trees-git-modified-color-override:var(--warning)]'
      )}
    />
  )
}
