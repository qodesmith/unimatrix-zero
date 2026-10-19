/**
 * Repo-specific lint rules, loaded by oxlint as a JS plugin:
 *
 * - Module-boundaries: a module is entered only through
 *   `src/modules/<name>/main.ts`
 * - Tsx-under-ui: `.tsx` files live under a `ui/` folder
 * - No-hardcoded-colors: the UI uses Theme tokens, never a palette colour
 */
import path from 'node:path'

type Node = {
  type: string
  source?: {value?: unknown} | null
  value?: unknown
  quasis?: {value: {raw: string}}[]
}

type Context = {
  physicalFilename: string
  report(diagnostic: {node: Node; message: string}): void
}

const moduleOf = (file: string) => {
  const match = /[/\\]src[/\\]modules[/\\]([^/\\]+)(?:[/\\](.*))?$/.exec(file)
  return match ? {name: match[1]!, rest: match[2] ?? ''} : null
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

const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: {description: 'Import another module only through its main.ts'},
  },
  create(context: Context) {
    const importer = context.physicalFilename
    const own = moduleOf(importer)
    const check = (node: Node) => {
      const specifier = node.source?.value
      if (typeof specifier !== 'string') return
      const target = resolveTarget(importer, specifier)
      if (!target) return
      const other = moduleOf(target)
      if (!other || (own && own.name === other.name)) return
      const entry = other.rest.replace(/\.(ts|tsx)$/, '')
      if (entry === 'main') return
      context.report({
        node,
        message: `Import module "${other.name}" through "#modules/${other.name}/main", not "${specifier}"`,
      })
    }
    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: (node: Node & {source: Node}) =>
        check({...node, source: node.source}),
    }
  },
}

const tsxUnderUi = {
  meta: {
    type: 'problem',
    docs: {description: '.tsx files live under a ui/ folder'},
  },
  create(context: Context) {
    return {
      Program(node: Node) {
        const file = context.physicalFilename
        if (!file.endsWith('.tsx')) return
        if (file.split(path.sep).includes('ui')) return
        context.report({node, message: '.tsx files belong under a ui/ folder'})
      },
    }
  },
}

const palette =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black'
const utilities =
  'bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|accent|caret|divide|placeholder|shadow|inset-ring|inset-shadow'
const paletteClass = new RegExp(
  `(?:^|\\s|:)(?:${utilities})-(?:${palette})(?:-\\d{2,3})?(?:/\\d+)?(?=\\s|$)`
)
const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/

const noHardcodedColors = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Colours come from Theme tokens, never a palette or a literal',
    },
  },
  create(context: Context) {
    const check = (node: Node, text: string) => {
      if (paletteClass.test(text) || colorLiteral.test(text)) {
        context.report({
          node,
          message:
            'Use a Theme token (bg-primary, text-muted-foreground, …), not a hard-coded colour',
        })
      }
    }
    return {
      Literal(node: Node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateLiteral(node: Node) {
        check(node, (node.quasis ?? []).map(part => part.value.raw).join(' '))
      },
    }
  },
}

export default {
  meta: {name: 'uz'},
  rules: {
    'module-boundaries': moduleBoundaries,
    'tsx-under-ui': tsxUnderUi,
    'no-hardcoded-colors': noHardcodedColors,
  },
}
