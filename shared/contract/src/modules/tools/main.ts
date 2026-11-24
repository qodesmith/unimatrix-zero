import {z} from 'zod'

/**
 * What a Tree's Tools panel switches on, read by every Reply from the Tree's
 * next one. Reading, writing files and running commands are not here: every
 * Tree has them (ADR 0022).
 */
export const TreeToolsSchema = z.strictObject({
  /** Claude's `WebSearch` and `WebFetch`; Codex's web search. */
  webSearch: z.boolean(),
  /** The connectors on the user's Claude account. */
  claudeConnectors: z.boolean(),
  /** The Skills that ship inside `claude`. */
  claudeBuiltInSkills: z.boolean(),
  /** The Skills that ship inside Codex. */
  chatgptBuiltInSkills: z.boolean(),
  /** The plugins OpenAI's servers offer Codex. */
  chatgptRemotePlugins: z.boolean(),
})

export type TreeTools = z.infer<typeof TreeToolsSchema>

export const DEFAULT_TREE_TOOLS: TreeTools = {
  webSearch: true,
  claudeConnectors: false,
  claudeBuiltInSkills: false,
  chatgptBuiltInSkills: false,
  chatgptRemotePlugins: false,
}
