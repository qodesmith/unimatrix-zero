import {Button} from '#shadcn/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#shadcn/ui/empty'
import {useSidebar} from '#shadcn/ui/sidebar'
import {GitForkIcon, PanelLeftIcon, PlusIcon} from 'lucide-react'

interface NoTreeOpenProps {
  hasTrees: boolean
  onCreate: () => void
}

export function NoTreeOpen({hasTrees, onCreate}: NoTreeOpenProps) {
  const sidebar = useSidebar()
  const sidebarShown = sidebar.isMobile ? sidebar.openMobile : sidebar.open

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitForkIcon />
        </EmptyMedia>
        <EmptyTitle>
          {hasTrees ? 'No Tree open' : 'Start a new Tree'}
        </EmptyTitle>
        <EmptyDescription>
          {hasTrees
            ? 'Pick a Tree from the sidebar, or start a new one.'
            : 'One conversation that can branch in any direction.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button onClick={onCreate}>
          <PlusIcon />
          New Tree
        </Button>
        {hasTrees && !sidebarShown && (
          <Button variant="outline" onClick={sidebar.toggleSidebar}>
            <PanelLeftIcon />
            Show Trees
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}
