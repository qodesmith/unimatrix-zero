import type {Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'

const DIRECTIVES = new Set(['use client', 'use server'])

export const noUseClient: Rule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'No React Server Components directives: nothing here renders on a server',
    },
    messages: {
      directive:
        "Remove '{{directive}}': this app has no React Server Components, so the directive means nothing. `shadcn add` can bring one in; `bun run lint:fix` removes it.",
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const {directive} = node

        if (!directive || !DIRECTIVES.has(directive)) return

        context.report({
          node,
          messageId: 'directive',
          data: {directive},
          fix: fixer => fixer.remove(node),
        })
      },
    }
  },
})
