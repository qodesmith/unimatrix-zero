import type {ESTree, Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'

import {colorLiteral, paletteClass} from '../../../theme-tokens.ts'

export const noHardcodedColors: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Colors come from Theme tokens, never a palette or a literal',
    },
    messages: {
      color:
        'Use a Theme token (bg-primary, text-muted-foreground, …), not a hard-coded color. See README.md, section Colors.',
    },
    schema: [],
  },
  create(context) {
    function check(node: ESTree.Node, text: string) {
      if (paletteClass.test(text) || colorLiteral.test(text))
        context.report({node, messageId: 'color'})
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map(part => part.value.raw).join(' '))
      },
    }
  },
})
