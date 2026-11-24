import {z} from 'zod'

/**
 * What a Tree's Tools panel switches on, read by every Reply from the Tree's
 * next one. Reading, writing files and running commands are not here: every
 * Tree has them (ADR 0022).
 */
export const TreeToolsSchema = z.strictObject({
  /** Claude's `WebSearch` and `WebFetch`; Codex's web search. */
  webSearch: z.boolean(),
  claudeConnectors: z.boolean(),
  claudeBuiltInSkills: z.boolean(),
  chatgptBuiltInSkills: z.boolean(),
  /** OpenAI's remote plugins, and the connectors on the ChatGPT account. */
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
