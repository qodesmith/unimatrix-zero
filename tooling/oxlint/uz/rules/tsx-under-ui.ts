import type {Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'
import path from 'node:path'

export const tsxUnderUi: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {description: '.tsx files live under a ui/ folder'},
    messages: {
      outside:
        '.tsx files belong under a ui/ folder. Plain .ts stays where it is. See README.md, section Modules.',
    },
    schema: [],
  },
  create(context) {
    const file = context.physicalFilename

    if (!file.endsWith('.tsx') || file.split(path.sep).includes('ui')) return {}

    return {
      Program(node) {
        context.report({node, messageId: 'outside'})
      },
    }
  },
})
