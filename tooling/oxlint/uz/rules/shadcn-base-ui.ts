import type {ESTree, Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'

const CONTROLS = new Set(['button', 'input', 'select', 'textarea'])

function isRadix(specifier: string) {
  return specifier === 'radix-ui' || specifier.startsWith('@radix-ui/')
}

export const shadcnBaseUi: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'The renderer builds its controls from shadcn components in the Base UI flavor, never Radix',
    },
    messages: {
      plain:
        'Use the shadcn component for <{{name}}> from #shadcn/ui/; add it with `shadcn add` if it is missing. See ADR 0020.',
      radix:
        'No Radix: shadcn components here use the Base UI flavor (base-vega). See ADR 0020.',
    },
    schema: [],
  },
  create(context) {
    const inShadcnUi = /[/\\]shadcn[/\\]ui[/\\]/.test(context.physicalFilename)

    function checkSource(source: ESTree.Node | null | undefined) {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return

      if (isRadix(source.value))
        context.report({node: source, messageId: 'radix'})
    }

    return {
      JSXOpeningElement(node) {
        if (inShadcnUi || node.name.type !== 'JSXIdentifier') return

        const {name} = node.name

        if (CONTROLS.has(name))
          context.report({node, messageId: 'plain', data: {name}})
      },
      ImportDeclaration: node => checkSource(node.source),
      ExportAllDeclaration: node => checkSource(node.source),
      ExportNamedDeclaration: node => checkSource(node.source),
      ImportExpression: node => checkSource(node.source),
    }
  },
})
