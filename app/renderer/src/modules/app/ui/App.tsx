import type {CommandResult} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'
import {
  Connections,
  anyConnected,
  useConnections,
} from '#modules/connections/main'
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
        <AppLayout />
      </LiveReplies>
    </QueryClientProvider>
  )
}

function AppLayout() {
  const connections = useConnections()
  const {trees, openTree, error: treesError, open, create, rename} = useTrees()
  // Null until main says whether any Provider is connected.
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null)
  const [showConnections, setShowConnections] = useState(false)
  const [pong, setPong] = useState<Pong | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (firstLaunch === null && connections.state.loaded) {
    setFirstLaunch(!anyConnected(connections.state))
  }

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

  async function startChatting() {
    await create()
    setFirstLaunch(false)
  }

  if (firstLaunch !== false) {
    return firstLaunch ? (
      <main className="h-full overflow-y-auto">
        <Connections
          connections={connections}
          onStart={() => void startChatting()}
        />
      </main>
    ) : null
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
        <h1 className="text-sm font-semibold">Unimatrix Zero</h1>
        <TreeList
          trees={trees}
          openTreeId={openTree?.id ?? null}
          onCreate={() => {
            setShowConnections(false)
            void create()
          }}
          onOpen={treeId => {
            setShowConnections(false)
            void open(treeId)
          }}
          onRename={(treeId, title) => void rename(treeId, title)}
        />
        {treesError && <p className="text-xs text-destructive">{treesError}</p>}
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto justify-start"
          aria-pressed={showConnections}
          onClick={() => setShowConnections(true)}
        >
          Connections
        </Button>
      </aside>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto bg-canvas-background">
        {showConnections ? (
          <Connections
            connections={connections}
            onBack={() => setShowConnections(false)}
          />
        ) : openTree ? (
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
