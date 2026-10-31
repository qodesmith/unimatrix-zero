import type {MermaidErrorComponentProps} from 'streamdown'

import {Alert, AlertDescription} from '#shadcn/ui/alert'

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
        <details>
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show code
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-foreground">
            {chart}
          </pre>
        </details>
      </AlertDescription>
    </Alert>
  )
}
