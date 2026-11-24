import type {TreeTools} from '@uz/contract/tools'

import {Group, Toggle} from '#modules/settings/main'

interface ToolSwitchesProps {
  tools: TreeTools
  onChange: (changes: Partial<TreeTools>) => void
}

/** The Tools panel's switches, each flip handing over its one key. */
export function ToolSwitches({tools, onChange}: ToolSwitchesProps) {
  return (
    <>
      <Toggle
        label="Web search"
        description="Lets the AI search the web and read web pages."
        checked={tools.webSearch}
        onChange={webSearch => onChange({webSearch})}
      />
      <Toggle
        label="Claude account connectors"
        description="The connectors on your Claude account. They add about 30,000 tokens each time the AI starts a Thread or reads one again."
        checked={tools.claudeConnectors}
        onChange={claudeConnectors => onChange({claudeConnectors})}
      />
      <Group legend="Built in · Claude">
        <Toggle
          label="Built-in Skills"
          description="The Skills that come with Claude Code."
          checked={tools.claudeBuiltInSkills}
          onChange={claudeBuiltInSkills => onChange({claudeBuiltInSkills})}
        />
      </Group>
      <Group legend="Built in · ChatGPT">
        <Toggle
          label="Built-in Skills"
          description="The Skills that come with Codex."
          checked={tools.chatgptBuiltInSkills}
          onChange={chatgptBuiltInSkills => onChange({chatgptBuiltInSkills})}
        />
        <Toggle
          label="Remote plugins"
          description="Plugins from OpenAI, and the connectors on your ChatGPT account."
          checked={tools.chatgptRemotePlugins}
          onChange={chatgptRemotePlugins => onChange({chatgptRemotePlugins})}
        />
      </Group>
    </>
  )
}
