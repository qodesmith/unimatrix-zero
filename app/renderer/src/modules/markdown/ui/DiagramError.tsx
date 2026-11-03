import type {MermaidErrorComponentProps} from 'streamdown'

import {Alert, AlertDescription} from '#shadcn/ui/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#shadcn/ui/collapsible'
import {ChevronRightIcon} from 'lucide-react'

/**
 * Replaces Streamdown's Mermaid error panel, which ships Tailwind's reds:
 * every color in the window is a Theme token (ADR 0009).
 */
export function DiagramError({chart, error}: MermaidErrorComponentProps) {
  return (
    <Alert variant="destructive" className="px-2 py-1 text-xs">
      <AlertDescription className="text-xs">
        <span className="text-destructive">
          This diagram could not be drawn: {error}
        </span>
        <Collapsible>
          <CollapsibleTrigger className="group/show-code-trigger flex w-full cursor-pointer items-center gap-1 text-muted-foreground select-none">
            <ChevronRightIcon className="size-3 shrink-0 transition-transform group-aria-expanded/show-code-trigger:rotate-90" />
            Show code
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-foreground">
              {chart}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  )
}
