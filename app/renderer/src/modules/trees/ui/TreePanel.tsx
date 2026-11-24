import type {Tree} from '@uz/contract/trees'

import {TreeSystemPrompt} from '#modules/system-prompts/main'
import {TreeToolsSection} from '#modules/tools/main'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#shadcn/ui/sheet'

import {TreeTitle} from './TreeTitle'

interface TreePanelProps {
  tree: Tree
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The one place a Tree's own values are shown and changed, each in a section. */
export function TreePanel({tree, open, onOpenChange}: TreePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Tree panel</SheetTitle>
          <SheetDescription className="truncate">
            <TreeTitle tree={tree} />
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4">
          <TreeSystemPrompt
            key={tree.systemPrompt.id}
            treeId={tree.id}
            systemPrompt={tree.systemPrompt}
          />
          <TreeToolsSection treeId={tree.id} tools={tree.tools} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
