import type {CommandResult} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'
import {Button} from '#modules/shadcn/main'
import {TreeList, TreeTitle, useTrees} from '#modules/trees/main'
import {LiveReplies, TreeView} from '#modules/turns/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'

type Pong = CommandResult<'app.ping'>

export function App() {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <LiveReplies>
        <Shell />
      </LiveReplies>
    </QueryClientProvider>
  )
}

function Shell() {
  const {trees, openTree, error: treesError, open, create, rename} = useTrees()
  const [pong, setPong] = useState<Pong | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ping() {
    const outcome = await bridge().send({
      type: 'app.ping',
      nonce: crypto.randomUUID(),
    })

    if (outcome.ok) {
      setPong(outcome.value)
      setError(null)
    } else {
      setError(outcome.error.message)
    }
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
        <h1 className="text-sm font-semibold">Unimatrix Zero</h1>
        <TreeList
          trees={trees}
          openTreeId={openTree?.id ?? null}
          onCreate={() => void create()}
          onOpen={treeId => void open(treeId)}
          onRename={(treeId, title) => void rename(treeId, title)}
        />
        {treesError && <p className="text-xs text-destructive">{treesError}</p>}
      </aside>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-canvas-background">
        {openTree ? (
          <>
            <h2 className="pt-4 text-lg font-semibold">
              <TreeTitle tree={openTree} />
            </h2>
            <TreeView key={openTree.id} treeId={openTree.id} />
          </>
        ) : (
          <>
            <Button onClick={() => void ping()}>Ping main</Button>
            {pong && (
              <p className="rounded-lg bg-prompt px-3 py-2 text-sm text-prompt-foreground">
                pong · {pong.nonce} · {pong.receivedAt}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}
      </main>
    </div>
  )
}
