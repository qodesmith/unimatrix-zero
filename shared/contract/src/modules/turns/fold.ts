import type {ReplyEvent, ReplyPart, ReplyProgress} from './schemas'

export const NEW_REPLY: ReplyProgress = {
  status: 'streaming',
  content: [],
  contextSize: null,
}

function withLastText(
  content: ReplyPart[],
  text: (current: string) => string
): ReplyPart[] {
  const last = content.at(-1)

  if (last?.type === 'text') {
    return [...content.slice(0, -1), {type: 'text', text: text(last.text)}]
  }

  return [...content, {type: 'text', text: text('')}]
}

function withToolCall(
  content: ReplyPart[],
  toolCallId: string,
  change: (part: Extract<ReplyPart, {type: 'tool-call'}>) => ReplyPart
): ReplyPart[] {
  return content.map(part =>
    part.type === 'tool-call' && part.toolCallId === toolCallId
      ? change(part)
      : part
  )
}

const CONTENT_EVENT_TYPES = [
  'TEXT_DELTA',
  'TEXT_REPLACE',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_RESULT',
] as const

type ContentEvent = Extract<
  ReplyEvent,
  {type: (typeof CONTENT_EVENT_TYPES)[number]}
>

const CONTENT_EVENTS: ReadonlySet<ReplyEvent['type']> = new Set(
  CONTENT_EVENT_TYPES
)

function changesContent(event: ReplyEvent): event is ContentEvent {
  return CONTENT_EVENTS.has(event.type)
}

function foldContent(content: ReplyPart[], event: ContentEvent): ReplyPart[] {
  if (event.type === 'TEXT_DELTA') {
    return withLastText(content, text => text + event.delta)
  }

  if (event.type === 'TEXT_REPLACE') {
    return withLastText(content, () => event.text)
  }

  if (event.type === 'TOOL_CALL_START') {
    const {toolCallId, toolName} = event

    return [
      ...content,
      {type: 'tool-call', toolCallId, toolName, args: '', result: null},
    ]
  }

  if (event.type === 'TOOL_CALL_ARGS') {
    return withToolCall(content, event.toolCallId, part => ({
      ...part,
      args: part.args + event.delta,
    }))
  }

  return withToolCall(content, event.toolCallId, part => ({
    ...part,
    result: {content: event.content, isError: event.isError},
  }))
}

/**
 * Folds one Reply event into what the Reply shows. Main and the window run
 * the same fold, so what main saves is what the window displayed. Events that
 * change nothing stored return the Reply unchanged, and a Subagent's events
 * are not part of its Reply's own content.
 */
export function foldReplyEvent<T extends ReplyProgress>(
  reply: T,
  event: ReplyEvent
): T {
  if (event.subagentId !== undefined) return reply

  if (event.type === 'TOKENS') return {...reply, contextSize: event.contextSize}

  if (event.type === 'RUN_FINISHED') return {...reply, status: event.status}

  if (!changesContent(event)) return reply

  return {...reply, content: foldContent(reply.content, event)}
}
