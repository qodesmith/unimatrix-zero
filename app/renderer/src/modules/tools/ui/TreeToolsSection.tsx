import type {TreeTools} from '@uz/contract/tools'

import {Refusal, useCommand} from '#modules/system-prompts/main'
import {useId} from 'react'

import {ToolSwitches} from './ToolSwitches'

interface TreeToolsSectionProps {
  treeId: string
  tools: TreeTools
}

export function TreeToolsSection({treeId, tools}: TreeToolsSectionProps) {
  const headingId = useId()
  const flip = useCommand()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-medium">
        Tools
      </h3>
      <ToolSwitches
        tools={tools}
        onChange={changes =>
          void flip.run({type: 'tree.set-tools', treeId, changes})
        }
      />
      <p className="text-sm text-muted-foreground">
        Applies from this Tree’s next Reply.
      </p>
      <Refusal error={flip.error} />
    </section>
  )
}
