import type {CommandResult} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'
import {Canvas} from '#modules/canvas/main'
import {
  Connections,
  ConnectionsProvider,
  anyConnected,
  useConnections,
} from '#modules/connections/main'
import {
  FollowFontSize,
  SettingsPage,
  SettingsProvider,
} from '#modules/settings/main'
import {TreeList, TreeTitle, useTrees} from '#modules/trees/main'
import {LiveReplies} from '#modules/turns/main'
import {Button} from '#shadcn/ui/button'
import {Sheet, SheetContent, SheetTrigger} from '#shadcn/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '#shadcn/ui/sidebar'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {SettingsIcon} from 'lucide-react'
import {useState} from 'react'

type Pong = CommandResult<'app.ping'>

export function App() {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <FollowFontSize />
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
    <SidebarProvider className="h-full min-h-0">
      <Sidebar
        collapsible="none"
        role="complementary"
        className="border-r border-sidebar-border"
      >
        <SidebarHeader>
          <h1 className="px-2 pt-2 text-sm font-semibold">Unimatrix Zero</h1>
        </SidebarHeader>
        <SidebarContent>
          <TreeList
            trees={trees}
            openTreeId={openTree?.id ?? null}
            onCreate={() => void create()}
            onOpen={treeId => void open(treeId)}
            onRename={(treeId, title) => void rename(treeId, title)}
          />
          {treesError && (
            <p className="px-4 text-xs text-destructive">{treesError}</p>
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <Sheet>
                <SheetTrigger render={<SidebarMenuButton />}>
                  <SettingsIcon />
                  <span>Settings</span>
                </SheetTrigger>
                <SheetContent
                  aria-label="Settings"
                  className="w-full gap-0 p-0 data-[side=right]:sm:max-w-4xl"
                >
                  <SettingsPage
                    connections={<Connections connections={connections} />}
                  />
                </SheetContent>
              </Sheet>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 bg-canvas-background">
        {openTree ? (
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
      </SidebarInset>
    </SidebarProvider>
  )
}
