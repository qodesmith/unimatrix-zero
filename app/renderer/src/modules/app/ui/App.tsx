import type {CommandResult} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'
import {Canvas} from '#modules/canvas/main'
import {
  Connections,
  ConnectionsProvider,
  anyConnected,
  useConnections,
} from '#modules/connections/main'
import {SettingsPage, SettingsProvider, TextSize} from '#modules/settings/main'
import {Button} from '#modules/shadcn/main'
import {TreeList, TreeTitle, useTrees} from '#modules/trees/main'
import {LiveReplies} from '#modules/turns/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'

type Pong = CommandResult<'app.ping'>

export function App() {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TextSize />
        <ConnectionsProvider>
          <LiveReplies>
            <AppLayout />
          </LiveReplies>
        </ConnectionsProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

function AppLayout() {
  const connections = useConnections()
  const {trees, openTree, error: treesError, open, create, rename} = useTrees()
  // Null until main says whether any Provider is connected.
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)
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
            setShowSettings(false)
            void create()
          }}
          onOpen={treeId => {
            setShowSettings(false)
            void open(treeId)
          }}
          onRename={(treeId, title) => void rename(treeId, title)}
        />
        {treesError && <p className="text-xs text-destructive">{treesError}</p>}
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto justify-start"
          aria-pressed={showSettings}
          onClick={() => setShowSettings(true)}
        >
          <GearIcon />
          Settings
        </Button>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas-background">
        {showSettings ? (
          <div className="min-h-0 flex-1">
            <SettingsPage
              connections={<Connections connections={connections} />}
            />
          </div>
        ) : openTree ? (
          <div className="min-h-0 flex-1">
            <Canvas
              key={openTree.id}
              treeId={openTree.id}
              title={<TreeTitle tree={openTree} />}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Button onClick={() => void ping()}>Ping main</Button>
            {pong && (
              <p className="rounded-lg bg-prompt px-3 py-2 text-sm text-prompt-foreground">
                pong · {pong.nonce} · {pong.receivedAt}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </main>
    </div>
  )
}

function GearIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
