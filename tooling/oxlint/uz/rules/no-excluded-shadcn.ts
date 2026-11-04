import type {Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'
import path from 'node:path'

const EXCLUDED = new Map([
  ['toast', 'Sonner (`#shadcn/ui/sonner`) is the toast'],
  [
    'code-block',
    'Streamdown draws code, through `#modules/markdown/main`. Delete `lib/highlighter.tsx` and `hooks/use-highlighted-code.ts` with it',
  ],
])

export const noExcludedShadcn: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'shadcn components we keep out, because another tool already does the job',
    },
    messages: {
      excluded:
        'Remove the shadcn `{{name}}` component: {{reason}}. See docs/code-style/styling-and-color.md.',
    },
    schema: [],
  },
  create(context) {
    const [file, folder, grandparent] = context.physicalFilename
      .split(path.sep)
      .toReversed()

    const name = file?.replace(/\.tsx?$/, '') ?? ''
    const reason = EXCLUDED.get(name)

    if (folder !== 'ui' || grandparent !== 'shadcn' || reason === undefined)
      return {}

    return {
      Program(node) {
        context.report({node, messageId: 'excluded', data: {name, reason}})
      },
    }
  },
})
