// oxlint-disable max-lines
/**
 * Oxlint JS plugin: `custom/only-export-components`
 *
 * A near-verbatim port of `eslint-plugin-react-refresh`'s
 * `only-export-components` rule
 * (https://github.com/ArnaudBarre/eslint-plugin-react-refresh), with one
 * addition: files that define a TanStack Router route are skipped entirely.
 *
 * WHY:
 *
 * TanStack routes are authored as `export const Route =
 * createFileRoute(...)` living in the same file as the route's component. That
 * non-component export (plus the co-located component) trips the stock rule,
 * but it is exactly the pattern TanStack's file-based routing requires — so we
 * exempt those files rather than sprinkle disable comments across every route.
 *
 * Detection is content-based (a top-level binding initialized by one of
 * TanStack Router's `create*Route*` factories), not path-based, so code-based
 * routes living anywhere in the code are covered.
 *
 * MANUAL TYPES:
 *
 * AST node types come from `@oxc-project/types` (Oxlint's own AST). Oxlint does
 * not yet export its `Rule`/`Context` types, so those are modelled locally
 * (only the members this rule touches). Both are alpha surfaces.
 *
 * PERFORMANCE:
 *
 * This rule is JS, not Rust — does that slow Oxlint down? Only marginally. The
 * file is parsed once, in Rust; the AST is shared with JS via Oxlint's "raw
 * transfer" mechanism, which makes the Rust<->JS boundary crossing near-zero
 * cost and lazily materializes only the nodes we touch. So we don't re-parse —
 * we only pay for running this rule's JS logic (plus a one-time JS-runtime
 * spin-up because `jsPlugins` is non-empty). That cost is further scoped by the
 * early returns below (only `.jsx`/`.tsx`, skipping test/story files), so it
 * runs only on the files that matter. Even with many JS-plugin rules Oxlint
 * stays ~5x faster than ESLint; one narrow rule is negligible.
 *
 * Could this be a native Rust rule instead? Not as a third-party rule — Oxlint
 * has no plugin ABI for external native rules; the ~650+ built-ins are compiled
 * into oxc itself. The only path to a Rust version would be upstreaming the
 * TanStack-skip behavior into `react/only-export-components` in the oxc repo.
 * Keeping it as a JS plugin is the right call for a single scoped rule.
 *
 * LIMITATIONS:
 *
 * Route detection is name-based and does not resolve imports, so the exemption
 * fails silently in one direction: a non-route file that initializes a
 * top-level binding with a `create*Route*`-named call (e.g. a local
 * `createRoute` helper) is exempted wholesale and stops reporting real
 * fast-refresh violations — no error, the rule just goes dark. It also only
 * inspects top-level `VariableDeclaration`s, so the "covers code-based routes"
 * contract holds for `export const Route = ...` / `const x = createRoute(...)`
 * shapes, not arbitrary ones. This is deemed an acceptable trade for avoiding
 * path coupling; the decoy case is pinned in the test suite
 * (`only-export-components.test.ts`).
 *
 * Refs:
 * https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha
 * https://oxc.rs/docs/guide/usage/linter/js-plugins
 */

import type {
  CallExpression,
  Node,
  Program,
  TaggedTemplateExpression,
} from '@oxc-project/types'

interface RuleOptions {
  extraHOCs?: string[]
  allowExportNames?: string[]
  allowConstantExport?: boolean
  checkJS?: boolean
}

type MessageId =
  | 'exportAll'
  | 'namedExport'
  | 'anonymousExport'
  | 'localComponents'
  | 'noExport'
  | 'reactContext'

// Minimal shapes for the ESLint-compatible context Oxlint hands to `create`.
interface Scope {
  variables: {name: string; defs: {type: string; node: Node}[]}[]
}
interface SourceCode {
  getScope?: (node: Node) => Scope
}
interface RuleContext {
  options: readonly unknown[]
  filename?: string
  getFilename?: () => string
  sourceCode?: SourceCode
  getSourceCode?: () => SourceCode
  report: (descriptor: {messageId: MessageId; node: Node}) => void
}
interface Plugin {
  meta: {name: string}
  rules: Record<
    string,
    {meta: unknown; create: (context: RuleContext) => Record<string, unknown>}
  >
}

const reactComponentNameRE = /^[A-Z][a-zA-Z0-9_]*$/u

// TanStack Router route factories. A file using any of these is treated as a
// route module and skipped. (Router factories like `createRouter` are NOT here
// — those files aren't route modules and should still be linted.)
const routeCreators = new Set([
  'createFileRoute',
  'createLazyFileRoute',
  'createRootRoute',
  'createRootRouteWithContext',
  'createRoute',
])

const constantExportExpressions = new Set([
  'Literal', // 1, "foo"
  'UnaryExpression', // -1
  'TemplateLiteral', // `Some ${template}`
  'BinaryExpression', // 24 * 60
])

const skipTSWrapper = (node: Node): Node => {
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion' ||
    node.type === 'TSInstantiationExpression'
  ) {
    return node.expression
  }
  return node
}

// True when `node` is (or is a call chain / member chain rooted at) a call to a
// TanStack Router route factory. Handles the curried form used by TanStack, e.g.
// `createFileRoute('/')({ component })` and `createRootRouteWithContext<T>()({...})`.
const isRouteCreatorCall = (node: Node | null | undefined): boolean => {
  if (!node) return false
  const n = skipTSWrapper(node)
  if (n.type === 'CallExpression') {
    const callee = skipTSWrapper(n.callee)
    if (callee.type === 'Identifier' && routeCreators.has(callee.name)) {
      return true
    }
    // Curried calls (`createFileRoute('/')(...)`) or member access chains.
    return isRouteCreatorCall(callee)
  }
  if (n.type === 'MemberExpression') {
    if (
      n.property.type === 'Identifier' &&
      routeCreators.has(n.property.name)
    ) {
      return true
    }
    return isRouteCreatorCall(n.object)
  }
  return false
}

// A file is a route module if any top-level binding is initialized by a route
// factory, whether or not it's the (conventional) `export const Route`.
const definesTanStackRoute = (program: Program): boolean => {
  for (const node of program.body) {
    const declaration: Node | null =
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportDefaultDeclaration'
        ? node.declaration
        : node
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const variable of declaration.declarations) {
      if (variable.init && isRouteCreatorCall(variable.init)) return true
    }
  }
  return false
}

const messages: Record<MessageId, string> = {
  exportAll: "This rule can't verify that `export *` only exports components.",
  namedExport:
    'Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components.',
  anonymousExport:
    "Fast refresh can't handle anonymous components. Add a name to your export.",
  localComponents:
    'Fast refresh only works when a file only exports components. Move your component(s) to a separate file.',
  noExport:
    'Fast refresh only works when a file has exports. Move your component(s) to a separate file.',
  reactContext:
    'Fast refresh only works when a file only exports components. Move your React context(s) to a separate file.',
}

const rule = {
  meta: {
    type: 'problem',
    messages,
    schema: [
      {
        type: 'object',
        properties: {
          extraHOCs: {type: 'array', items: {type: 'string'}},
          allowExportNames: {type: 'array', items: {type: 'string'}},
          allowConstantExport: {type: 'boolean'},
          checkJS: {type: 'boolean'},
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: RuleContext) {
    const {
      extraHOCs = [],
      allowExportNames,
      allowConstantExport = false,
      checkJS = false,
    } = (context.options[0] ?? {}) as RuleOptions

    const filename = context.filename ?? context.getFilename?.() ?? ''
    // Skip tests & stories files
    if (
      filename.includes('.test.') ||
      filename.includes('.spec.') ||
      filename.includes('.cy.') ||
      filename.includes('.stories.')
    ) {
      return {}
    }
    const shouldScan =
      filename.endsWith('.jsx') ||
      filename.endsWith('.tsx') ||
      (checkJS && filename.endsWith('.js'))
    if (!shouldScan) return {}

    const sourceCode = context.sourceCode ?? context.getSourceCode?.()
    const allowExportNamesSet = allowExportNames
      ? new Set(allowExportNames)
      : undefined

    const validHOCs = ['memo', 'forwardRef', 'lazy', ...extraHOCs]

    const getHocName = (
      node: CallExpression | TaggedTemplateExpression
    ): string | undefined => {
      const callee = node.type === 'CallExpression' ? node.callee : node.tag
      if (callee.type === 'CallExpression') {
        return getHocName(callee)
      }
      if (callee.type === 'MemberExpression') {
        if (
          callee.property.type === 'Identifier' &&
          validHOCs.includes(callee.property.name)
        ) {
          return callee.property.name
        }
        if (
          callee.object.type === 'Identifier' &&
          validHOCs.includes(callee.object.name)
        ) {
          return callee.object.name
        }
        if (callee.object.type === 'CallExpression') {
          return getHocName(callee.object)
        }
      }
      if (callee.type === 'Identifier') {
        return callee.name
      }
      return undefined
    }

    const isCallExpressionReactComponent = (
      node: CallExpression
    ): boolean | 'needName' => {
      const hocName = getHocName(node)
      if (!hocName || !validHOCs.includes(hocName)) return false
      const validateArgument = hocName === 'memo' || hocName === 'forwardRef'
      if (!validateArgument) return true
      if (node.arguments.length === 0) return false
      const arg = skipTSWrapper(node.arguments[0])
      switch (arg.type) {
        case 'Identifier':
          return reactComponentNameRE.test(arg.name)
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (!arg.id) return 'needName'
          return reactComponentNameRE.test(arg.id.name)
        case 'CallExpression':
          return isCallExpressionReactComponent(arg)
        default:
          return false
      }
    }

    const isExpressionReactComponent = (
      expressionParam: Node
    ): boolean | 'needName' => {
      const exp = skipTSWrapper(expressionParam)
      if (exp.type === 'Identifier') {
        return reactComponentNameRE.test(exp.name)
      }
      if (
        exp.type === 'ArrowFunctionExpression' ||
        exp.type === 'FunctionExpression'
      ) {
        if (exp.params.length > 2) return false
        if (!exp.id?.name) return 'needName'
        return reactComponentNameRE.test(exp.id.name)
      }
      if (exp.type === 'ConditionalExpression') {
        const consequent = isExpressionReactComponent(exp.consequent)
        const alternate = isExpressionReactComponent(exp.alternate)
        if (consequent === false || alternate === false) return false
        if (consequent === 'needName' || alternate === 'needName') {
          return 'needName'
        }
        return true
      }
      if (exp.type === 'CallExpression') {
        return isCallExpressionReactComponent(exp)
      }
      if (exp.type === 'TaggedTemplateExpression') {
        const hocName = getHocName(exp)
        if (!hocName || !validHOCs.includes(hocName)) return false
        return 'needName'
      }
      return false
    }

    return {
      Program(program: Program) {
        // The one deviation from eslint-plugin-react-refresh: skip TanStack
        // Router route modules wholesale.
        if (definesTanStackRoute(program)) return

        let hasExports = false
        let hasReactExport = false
        let reactIsInScope = false
        const localComponents: Node[] = []
        const nonComponentExports: Node[] = []
        const reactContextExports: Node[] = []

        const handleExportIdentifier = (
          identifierNode: Node,
          initParam?: Node
        ) => {
          if (identifierNode.type !== 'Identifier') {
            nonComponentExports.push(identifierNode)
            return
          }
          if (allowExportNamesSet?.has(identifierNode.name)) return

          if (!initParam) {
            if (reactComponentNameRE.test(identifierNode.name)) {
              hasReactExport = true
            } else {
              nonComponentExports.push(identifierNode)
            }
            return
          }

          const init = skipTSWrapper(initParam)
          if (allowConstantExport && constantExportExpressions.has(init.type)) {
            return
          }

          if (
            init.type === 'CallExpression' &&
            ((init.callee.type === 'Identifier' &&
              init.callee.name === 'createContext') ||
              (init.callee.type === 'MemberExpression' &&
                init.callee.property.type === 'Identifier' &&
                init.callee.property.name === 'createContext'))
          ) {
            reactContextExports.push(identifierNode)
            return
          }

          const isReactComponent =
            reactComponentNameRE.test(identifierNode.name) &&
            isExpressionReactComponent(init)

          if (isReactComponent === false) {
            nonComponentExports.push(identifierNode)
          } else {
            hasReactExport = true
          }
        }

        const handleExportDeclaration = (node: Node) => {
          if (node.type === 'VariableDeclaration') {
            for (const variable of node.declarations) {
              if (variable.init === null) {
                nonComponentExports.push(variable.id)
                continue
              }
              handleExportIdentifier(variable.id, variable.init)
            }
          } else if (node.type === 'FunctionDeclaration') {
            if (node.id === null) {
              context.report({messageId: 'anonymousExport', node})
            } else {
              handleExportIdentifier(node.id)
            }
          } else if (node.type === 'ClassDeclaration') {
            if (node.id === null) {
              context.report({messageId: 'anonymousExport', node})
            } else if (
              reactComponentNameRE.test(node.id.name) &&
              node.superClass !== null &&
              node.body.body.some(
                item =>
                  item.type === 'MethodDefinition' &&
                  item.key.type === 'Identifier' &&
                  item.key.name === 'render'
              )
            ) {
              hasReactExport = true
            } else {
              nonComponentExports.push(node.id)
            }
          } else if (node.type === 'CallExpression') {
            const result = isCallExpressionReactComponent(node)
            if (result === false) {
              nonComponentExports.push(node)
            } else if (result === 'needName') {
              context.report({messageId: 'anonymousExport', node})
            } else {
              hasReactExport = true
            }
          } else {
            nonComponentExports.push(node)
          }
        }

        for (const node of program.body) {
          if (node.type === 'ExportAllDeclaration') {
            if (node.exportKind === 'type') continue
            hasExports = true
            context.report({messageId: 'exportAll', node})
          } else if (node.type === 'ExportDefaultDeclaration') {
            hasExports = true
            const declaration = skipTSWrapper(node.declaration)
            if (
              declaration.type === 'VariableDeclaration' ||
              declaration.type === 'FunctionDeclaration' ||
              declaration.type === 'ClassDeclaration' ||
              declaration.type === 'CallExpression'
            ) {
              handleExportDeclaration(declaration)
            }
            if (declaration.type === 'Identifier') {
              handleExportIdentifier(declaration)
            }
            if (declaration.type === 'ArrowFunctionExpression') {
              context.report({messageId: 'anonymousExport', node})
            }
          } else if (node.type === 'ExportNamedDeclaration') {
            if (node.exportKind === 'type') continue
            const declaration = node.declaration
              ? skipTSWrapper(node.declaration)
              : null
            if (declaration?.type === 'TSDeclareFunction') continue
            hasExports = true
            if (declaration) handleExportDeclaration(declaration)
            for (const specifier of node.specifiers) {
              if (
                specifier.local.type === 'Identifier' &&
                sourceCode?.getScope
              ) {
                const scope = sourceCode.getScope(node)
                const localName = specifier.local.name
                const def = scope.variables.find(v => v.name === localName)
                  ?.defs[0]
                if (def?.type === 'ClassName') {
                  handleExportDeclaration(def.node)
                  continue
                }
              }
              handleExportIdentifier(
                specifier.exported.type === 'Identifier' &&
                  specifier.exported.name === 'default'
                  ? specifier.local
                  : specifier.exported
              )
            }
          } else if (node.type === 'VariableDeclaration') {
            for (const variable of node.declarations) {
              if (
                variable.id.type === 'Identifier' &&
                reactComponentNameRE.test(variable.id.name) &&
                variable.init !== null &&
                isExpressionReactComponent(variable.init) !== false
              ) {
                localComponents.push(variable.id)
              }
            }
          } else if (node.type === 'FunctionDeclaration') {
            if (node.id && reactComponentNameRE.test(node.id.name)) {
              localComponents.push(node.id)
            }
          } else if (
            node.type === 'ImportDeclaration' &&
            node.source.value === 'react'
          ) {
            reactIsInScope = true
          }
        }

        if (checkJS && !reactIsInScope) return

        if (hasExports) {
          if (hasReactExport) {
            for (const node of nonComponentExports) {
              context.report({messageId: 'namedExport', node})
            }
            for (const node of reactContextExports) {
              context.report({messageId: 'reactContext', node})
            }
          } else if (localComponents.length) {
            for (const node of localComponents) {
              context.report({messageId: 'localComponents', node})
            }
          }
        } else if (localComponents.length) {
          for (const node of localComponents) {
            context.report({messageId: 'noExport', node})
          }
        }
      },
    }
  },
}

const plugin: Plugin = {
  meta: {name: 'custom'},
  rules: {'only-export-components': rule},
}

// oxlint-disable-next-line import/no-default-export
export default plugin
