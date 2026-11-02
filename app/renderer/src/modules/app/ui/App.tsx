import {Canvas} from '#modules/canvas/main'
import {
  Connections,
  ConnectionsProvider,
  anyConnected,
  useConnections,
} from '#modules/connections/main'
import {
  LayoutProvider,
  SidebarToggle,
  useLayout,
  useUpdateLayout,
} from '#modules/layout/main'
import {
  FollowFontSize,
  SettingsPage,
  SettingsProvider,
} from '#modules/settings/main'
import {NoTreeOpen, TreeList, TreeTitle, useTrees} from '#modules/trees/main'
import {LiveReplies} from '#modules/turns/main'
import {Alert, AlertDescription} from '#shadcn/ui/alert'
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
import {TooltipProvider} from '#shadcn/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {SettingsIcon} from 'lucide-react'
import {useState} from 'react'

export function App() {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <FollowFontSize />
        <LayoutProvider>
          <ConnectionsProvider>
            <LiveReplies>
              <TooltipProvider>
                <AppLayout />
              </TooltipProvider>
            </LiveReplies>
          </ConnectionsProvider>
        </LayoutProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

function AppLayout() {
  const connections = useConnections()
  const layout = useLayout()
  const updateLayout = useUpdateLayout()
  const {trees, openTree, error: treesError, open, create, rename} = useTrees()
  // Null until main says whether any Provider is connected.
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null)

  if (firstLaunch === null && connections.state.loaded) {
    setFirstLaunch(!anyConnected(connections.state))
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
    <SidebarProvider
      className="h-full min-h-0"
      open={layout.sidebarOpen}
      onOpenChange={sidebarOpen => void updateLayout({sidebarOpen})}
    >
      <Sidebar
        collapsible="offcanvas"
        role="complementary"
        inert={!layout.sidebarOpen}
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
            <Alert variant="destructive" className="mx-2 w-auto">
              <AlertDescription className="text-xs">
                {treesError}
              </AlertDescription>
            </Alert>
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
              sidebarToggle={<SidebarToggle />}
            />
          </div>
        ) : (
          <>
            <header className="flex min-h-12 shrink-0 items-center px-4 pt-4 pb-2">
              <SidebarToggle />
            </header>
            <NoTreeOpen
              hasTrees={trees.length > 0}
              onCreate={() => void create()}
            />
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
