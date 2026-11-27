import type {RecordedLine, RecordedMessageSchema} from './replay'

import fs from 'node:fs'
import path from 'node:path'
import {z} from 'zod'

import {RECORDINGS, RecordedLineSchema} from './replay'

const ToolInputSchema = z.looseObject({
  command: z.string().optional(),
  content: z.string().optional(),
  file_path: z.string().optional(),
})

type ToolInput = z.infer<typeof ToolInputSchema>

export function readRecording(name: string): RecordedLine[] {
  return fs
    .readFileSync(path.join(RECORDINGS, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => RecordedLineSchema.parse(JSON.parse(line)))
}

interface RecordedToolCall {
  id: string
  name: string
  input: ToolInput
  /** Null until a result comes back, or when it isn't plain text. */
  result: string | null
}

/** What one Prompt's run up to its `result` holds that a re-record changes. */
interface RecordedReply {
  sessionId: string
  /** The last assistant entry, which the Reply is recorded at. */
  messageId: string
  text: string
  textDeltas: string[]
  /** Text deltas streamed before the SDK asked `claude` to stop, else all. */
  streamedBeforeInterrupt: number
  /** As the last `message_delta` reports it: what that request sent and wrote. */
  contextSize: number | null
  boundaryIds: string[]
  toolCalls: RecordedToolCall[]
}

interface Draft extends Omit<
  RecordedReply,
  'sessionId' | 'messageId' | 'streamedBeforeInterrupt'
> {
  messageId: string | null
  streamedBeforeInterrupt: number | null
}

const ResultSchema = z.looseObject({
  type: z.literal('result'),
  session_id: z.string(),
})

const AssistantSchema = z.looseObject({
  type: z.literal('assistant'),
  uuid: z.string(),
  parent_tool_use_id: z.null(),
  message: z.looseObject({
    model: z.string(),
    content: z.array(z.unknown()),
  }),
})

const TextPartSchema = z.looseObject({
  type: z.literal('text'),
  text: z.string(),
})

const ToolUsePartSchema = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: ToolInputSchema,
})

const ToolResultsSchema = z.looseObject({
  type: z.literal('user'),
  parent_tool_use_id: z.null(),
  message: z.looseObject({content: z.array(z.unknown())}),
})

const ToolResultPartSchema = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
})

const StreamEventSchema = z.looseObject({
  type: z.literal('stream_event'),
  parent_tool_use_id: z.null(),
  event: z.looseObject({type: z.string()}),
})

const TextDeltaSchema = z.looseObject({
  type: z.literal('content_block_delta'),
  delta: z.looseObject({type: z.literal('text_delta'), text: z.string()}),
})

const MessageDeltaSchema = z.looseObject({
  type: z.literal('message_delta'),
  usage: z.looseObject({
    input_tokens: z.number().nullish(),
    cache_creation_input_tokens: z.number().nullish(),
    cache_read_input_tokens: z.number().nullish(),
    output_tokens: z.number(),
  }),
})

const BoundarySchema = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('compact_boundary'),
  uuid: z.string(),
})

const InterruptSchema = z.looseObject({
  type: z.literal('control_request'),
  request: z.looseObject({subtype: z.literal('interrupt')}),
})

function newDraft(): Draft {
  return {
    messageId: null,
    text: '',
    textDeltas: [],
    streamedBeforeInterrupt: null,
    contextSize: null,
    boundaryIds: [],
    toolCalls: [],
  }
}

function addAssistant(draft: Draft, message: z.infer<typeof AssistantSchema>) {
  if (message.message.model === '<synthetic>') return

  draft.messageId = message.uuid

  for (const part of message.message.content) {
    const text = TextPartSchema.safeParse(part)
    const toolUse = ToolUsePartSchema.safeParse(part)

    if (text.success) draft.text += text.data.text

    if (toolUse.success) {
      const {id, name, input} = toolUse.data
      draft.toolCalls.push({id, name, input, result: null})
    }
  }
}

function addToolResults(draft: Draft, content: unknown[]) {
  for (const part of content) {
    const result = ToolResultPartSchema.safeParse(part)

    const call = draft.toolCalls.find(
      ({id}) => result.success && id === result.data.tool_use_id
    )

    if (call && result.success) call.result = result.data.content
  }
}

function addStreamEvent(
  draft: Draft,
  {event}: z.infer<typeof StreamEventSchema>
) {
  const delta = TextDeltaSchema.safeParse(event)
  const ended = MessageDeltaSchema.safeParse(event)

  if (delta.success) draft.textDeltas.push(delta.data.delta.text)

  if (ended.success) {
    const {usage} = ended.data

    draft.contextSize =
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      usage.output_tokens
  }
}

function addOut(draft: Draft, message: z.infer<typeof RecordedMessageSchema>) {
  const assistant = AssistantSchema.safeParse(message)
  const streamed = StreamEventSchema.safeParse(message)
  const boundary = BoundarySchema.safeParse(message)
  const results = ToolResultsSchema.safeParse(message)

  if (assistant.success) addAssistant(draft, assistant.data)

  if (results.success) addToolResults(draft, results.data.message.content)

  if (streamed.success) addStreamEvent(draft, streamed.data)

  if (boundary.success) draft.boundaryIds.push(boundary.data.uuid)
}

function repliesIn(lines: RecordedLine[]) {
  const replies: RecordedReply[] = []
  let draft = newDraft()

  for (const line of lines) {
    if (line.kind === 'in' && InterruptSchema.safeParse(line.message).success) {
      draft.streamedBeforeInterrupt ??= draft.textDeltas.length
    }

    if (line.kind !== 'out') continue

    addOut(draft, line.message)
    const result = ResultSchema.safeParse(line.message)

    if (!result.success) continue

    const {messageId} = draft

    if (messageId === null) throw new Error('A Reply has no assistant entry')

    replies.push({
      ...draft,
      sessionId: result.data.session_id,
      messageId,
      streamedBeforeInterrupt:
        draft.streamedBeforeInterrupt ?? draft.textDeltas.length,
    })
    draft = newDraft()
  }

  return replies
}

const read = new Map<string, RecordedReply[]>()

/** The Reply of the recording's `index`th `result`, counted from 0. */
export function recordedReply(name: string, index: number) {
  const replies = read.get(name) ?? repliesIn(readRecording(name))
  read.set(name, replies)
  const reply = replies[index]

  if (!reply) throw new Error(`${name} has no Reply ${index}`)

  return reply
}

function quoted(text: string) {
  return JSON.stringify(text).slice(1, -1)
}

/** As the fake writes it: the folder it ran in for the one it was recorded in. */
export function inFolder(
  name: string,
  input: ToolInput | undefined,
  folder: string
) {
  const [start] = readRecording(name)

  if (!input || start?.kind !== 'start' || !start.cwd) return input

  return ToolInputSchema.parse(
    JSON.parse(
      JSON.stringify(input).replaceAll(quoted(start.cwd), quoted(folder))
    )
  )
}
