import type {useTrees} from '#modules/trees/main'
import type {ReactNode} from 'react'

import {SidebarSections} from '#modules/layout/main'
import {SettingsPage} from '#modules/settings/main'
import {NewTreeButton, TreeList} from '#modules/trees/main'
import {Alert, AlertDescription} from '#shadcn/ui/alert'
import {Sheet, SheetContent, SheetTrigger} from '#shadcn/ui/sheet'
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#shadcn/ui/sidebar'
import {SettingsIcon} from 'lucide-react'

interface AppSidebarProps {
  trees: ReturnType<typeof useTrees>
  connections: ReactNode
}

export function AppSidebar({trees, connections}: AppSidebarProps) {
  return (
    <>
      <SidebarHeader>
        <h1 className="px-2 pt-2 text-sm font-semibold">Unimatrix Zero</h1>
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden">
        <SidebarSections
          trees={{
            title: 'Trees',
            actions: <NewTreeButton onCreate={() => void trees.create()} />,
            children: (
              <TreeList
                trees={trees.trees}
                hasTrees={trees.hasTrees}
                openTreeId={trees.openTree?.id ?? null}
                onOpen={treeId => void trees.open(treeId)}
                onRename={(treeId, title) => void trees.rename(treeId, title)}
              />
            ),
          }}
          files={{title: 'Files'}}
          usage={{title: 'Usage'}}
        />
        {trees.error && (
          <Alert variant="destructive" className="mx-2 my-2 w-auto">
            <AlertDescription className="text-xs">
              {trees.error}
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
                <SettingsPage connections={connections} />
              </SheetContent>
            </Sheet>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  )
}
