import {Canvas} from '#modules/canvas/main'
import {
  Connections,
  ConnectionsProvider,
  ProviderTabs,
  anyConnected,
  useConnections,
} from '#modules/connections/main'
import {
  LayoutProvider,
  LayoutSidebar,
  SidebarToggle,
} from '#modules/layout/main'
import {
  CompactionSettings,
  FollowFontSize,
  SettingsProvider,
} from '#modules/settings/main'
import {useStateMachine} from '#modules/state-machine/main'
import {NoTreeOpen, TreeTitle, useTrees} from '#modules/trees/main'
import {LiveReplies} from '#modules/turns/main'
import {SidebarInset} from '#shadcn/ui/sidebar'
import {TooltipProvider} from '#shadcn/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'

import {startChatting} from '../first-launch/actions'
import {
  firstLaunchTransition,
  initialFirstLaunch,
} from '../first-launch/machine'
import {AppSidebar} from './AppSidebar'

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
  const trees = useTrees()
  const {hasTrees, openTree, create} = trees

  const [firstLaunch, send] = useStateMachine({
    transition: firstLaunchTransition,
    initial: initialFirstLaunch,
  })

  if (firstLaunch.status === 'loading' && connections.state.loaded) {
    send({type: 'loaded', anyConnected: anyConnected(connections.state)})
  }

  function start() {
    if (
      firstLaunchTransition(firstLaunch, {type: 'startAsked'}) === firstLaunch
    ) {
      return
    }

    send({type: 'startAsked'})
    void startChatting({createTree: create, send})
  }

  switch (firstLaunch.status) {
    case 'loading':
      return null
    case 'connecting':
    case 'starting':
      return (
        <main className="h-full overflow-y-auto">
          <Connections connections={connections} onStart={start} />
        </main>
      )
    case 'ready':
      break
    default:
      throw new Error('Unknown first launch state.')
  }

  return (
    <LayoutSidebar
      sidebar={
        <AppSidebar
          trees={trees}
          connections={
            <ProviderTabs
              connections={connections}
              providerSettings={CompactionSettings}
            />
          }
        />
      }
    >
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
            {hasTrees !== null && (
              <NoTreeOpen hasTrees={hasTrees} onCreate={() => void create()} />
            )}
          </>
        )}
      </SidebarInset>
    </LayoutSidebar>
  )
}
