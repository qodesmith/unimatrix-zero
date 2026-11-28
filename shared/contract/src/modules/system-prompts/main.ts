import {z} from 'zod'

export const SYSTEM_PROMPT_MAX_LENGTH = 20_000

export const SYSTEM_PROMPT_NAME_MAX_LENGTH = 100

export const PresetIdSchema = z.enum([
  'default',
  'concise',
  'explain-simply',
  'coding-helper',
])

export type PresetId = z.infer<typeof PresetIdSchema>

/** A preset's id, or a UUIDv7 for one of the user's own. */
export const SystemPromptEntryIdSchema = z.union([PresetIdSchema, z.uuid()])

export const SystemPromptTextSchema = z.string().max(SYSTEM_PROMPT_MAX_LENGTH)

export const SystemPromptNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SYSTEM_PROMPT_NAME_MAX_LENGTH)

export const SystemPromptEntrySchema = z.strictObject({
  id: SystemPromptEntryIdSchema,
  name: z.string(),
  text: SystemPromptTextSchema,
  preset: z.boolean(),
})

export type SystemPromptEntry = z.infer<typeof SystemPromptEntrySchema>

export const SystemPromptLibrarySchema = z.strictObject({
  /** The presets in this order, then the user's own, oldest first. */
  entries: z.array(SystemPromptEntrySchema),
})

export type SystemPromptLibrary = z.infer<typeof SystemPromptLibrarySchema>

export const TreeSystemPromptSchema = z.strictObject({
  id: z.uuid(),
  text: SystemPromptTextSchema,
})

export type TreeSystemPrompt = z.infer<typeof TreeSystemPromptSchema>

function preset(id: PresetId, name: string, text: string): SystemPromptEntry {
  return {id, name, text, preset: true}
}

export const PRESETS: readonly SystemPromptEntry[] = [
  preset(
    'default',
    'Default',
    'You are a helpful assistant. Answer clearly and accurately, and say so when you are not sure. If a request is unclear, ask before you guess. Format answers in Markdown where it helps: headings, lists, tables, and code blocks that name their language.'
  ),
  preset(
    'concise',
    'Concise',
    'Answer as briefly as the question allows. Lead with the answer itself, with no preamble and no recap. Leave out caveats unless they change the answer. Use Markdown only where it makes the answer shorter or clearer.'
  ),
  preset(
    'explain-simply',
    'Explain simply',
    'Explain things in plain, everyday words, as you would to a curious friend who knows nothing of the subject. Avoid jargon, and when a technical word is needed, say what it means. Use short sentences, concrete examples and, where it helps, numbered steps.'
  ),
  preset(
    'coding-helper',
    'Coding helper',
    "You are an experienced software engineer helping with code. Read the code that matters before you change it, keep each change small and focused, and follow the project's existing style. Say what you changed and why, and name any risk or anything left to check. Put code in Markdown code blocks that name their language."
  ),
]

/** An id no entry has any more, as after a deletion, falls back to Default. */
export function defaultEntry(
  entries: readonly SystemPromptEntry[],
  defaultId: string
): SystemPromptEntry {
  const found =
    entries.find(entry => entry.id === defaultId) ??
    PRESETS.find(entry => entry.id === 'default')

  if (!found) throw new Error('The Default preset is missing.')

  return found
}
