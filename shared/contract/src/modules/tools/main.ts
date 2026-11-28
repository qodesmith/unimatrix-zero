import {z} from 'zod'

/**
 * What a Tree's Tools panel switches on, from its next Reply. Reading, writing
 * files and running commands are not here: every Tree has them.
 */
export const TreeToolsSchema = z.strictObject({
  webSearch: z.boolean(),
  claudeConnectors: z.boolean(),
  claudeBuiltInSkills: z.boolean(),
  chatgptBuiltInSkills: z.boolean(),
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
