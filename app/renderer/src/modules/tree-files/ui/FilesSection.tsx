import {Refusal, useCommand} from '#modules/bridge/main'
import {Button} from '#shadcn/ui/button'

import {
  useOpenTreeFile,
  useShownTreeFiles,
  useTreeFileList,
} from '../use-tree-files'
import {FilesTree} from './FilesTree'

function Quiet({children}: {children: string}) {
  return <p className="px-4 py-3 text-xs text-muted-foreground">{children}</p>
}

interface SnapshotProps {
  treeId: string
  replyId: string
}

function EarlierTurn({
  treeId,
  replyId,
  saves,
}: SnapshotProps & {saves: boolean}) {
  const {error, run} = useCommand()

  return (
    <div className="mx-2 mb-1 flex flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
      <p>These files are as they were at an earlier Turn.</p>
      {saves && (
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() =>
            void run({type: 'tree-files.save-copy', treeId, replyId})
          }
        >
          Save a copy…
        </Button>
      )}
      <Refusal error={error} />
    </div>
  )
}

function Snapshot({treeId, replyId}: SnapshotProps) {
  const list = useTreeFileList(treeId, replyId, {keepLastShown: true})
  const open = useOpenTreeFile()

  if (list.isPending) return null

  if (list.isError) return <Refusal error={list.error.message} />

  const {files, onDisk} = list.data

  return (
    <div className="flex h-full flex-col">
      {!onDisk && (
        <EarlierTurn
          treeId={treeId}
          replyId={replyId}
          saves={files.some(file => file.change !== 'deleted')}
        />
      )}
      {files.length === 0 ? (
        <Quiet>No files yet.</Quiet>
      ) : (
        <div className="min-h-0 flex-1">
          <FilesTree
            files={files}
            onOpen={path => open({treeId, replyId, path})}
          />
        </div>
      )}
    </div>
  )
}

/** The Snapshot of the Reply the canvas follows, without touching disk. */
export function FilesSection() {
  const shown = useShownTreeFiles()

  if (!shown) return <Quiet>No Tree open.</Quiet>

  if (shown.replyId === null) return <Quiet>No files yet.</Quiet>

  return <Snapshot treeId={shown.treeId} replyId={shown.replyId} />
}
