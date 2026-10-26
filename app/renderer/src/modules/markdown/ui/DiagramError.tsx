import type {MermaidErrorComponentProps} from 'streamdown'

/**
 * Replaces Streamdown's Mermaid error panel, which ships Tailwind's reds:
 * every color in the window is a Theme token (ADR 0009).
 */
export function DiagramError({chart, error}: MermaidErrorComponentProps) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs"
    >
      <span className="text-destructive">
        This diagram could not be drawn: {error}
      </span>
      <details>
        <summary className="cursor-pointer text-muted-foreground select-none">
          Show code
        </summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{chart}</pre>
      </details>
    </div>
  )
}
