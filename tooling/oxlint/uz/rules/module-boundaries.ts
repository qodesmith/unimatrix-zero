import type {ESTree, Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'
import path from 'node:path'

function moduleOf(file: string) {
  const match = /[/\\]src[/\\]modules[/\\]([^/\\]+)(?:[/\\](.*))?$/.exec(file)
  const name = match?.[1]

  return name === undefined ? null : {name, rest: match?.[2] ?? ''}
}

function resolveTarget(importer: string, specifier: string): string | null {
  if (specifier.startsWith('#modules/')) {
    const srcIndex = importer.lastIndexOf(`${path.sep}src${path.sep}`)

    if (srcIndex === -1) return null

    return path.join(
      importer.slice(0, srcIndex),
      'src',
      'modules',
      specifier.slice('#modules/'.length)
    )
  }

  if (specifier.startsWith('.'))
    return path.resolve(path.dirname(importer), specifier)

  return null
}

export const moduleBoundaries: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {description: 'Import another module only through its main.ts'},
    messages: {
      private:
        'Import module "{{name}}" through "#modules/{{name}}/main", not "{{specifier}}". See README.md, section Modules.',
    },
    schema: [],
  },
  create(context) {
    const importer = context.physicalFilename
    const own = moduleOf(importer)

    function check(source: ESTree.Node | null | undefined) {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return
      const specifier = source.value
      const target = resolveTarget(importer, specifier)

      if (!target) return
      const other = moduleOf(target)

      if (!other || own?.name === other.name) return
      const entry = other.rest.replace(/\.(ts|tsx)$/, '')

      if (entry === 'main') return
      context.report({
        node: source,
        messageId: 'private',
        data: {name: other.name, specifier},
      })
    }

    return {
      ImportDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
    }
  },
})
