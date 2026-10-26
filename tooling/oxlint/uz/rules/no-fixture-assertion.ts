import type {ESTree, Rule} from '@oxlint/plugins'

import {defineRule} from '@oxlint/plugins'

type Node = ESTree.Node

const TEST_FUNCTIONS = new Set(['it', 'test'])

/** Matchers that read a mock's record, which the unit writes. */
const MOCK_MATCHER = /^toHave(?:Been|Last|Nth)?(?:Called|Returned)/u

const MODIFIERS = new Set(['not', 'resolves', 'rejects'])

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value
}

function children(node: Node): Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'parent') return []

    if (Array.isArray(value)) return value.filter(isNode)

    return isNode(value) ? [value] : []
  })
}

function* walk(node: Node): Generator<Node> {
  yield node

  for (const child of children(node)) yield* walk(child)
}

function propertyName(node: Node) {
  if (node.type !== 'MemberExpression' || node.computed) return undefined

  return node.property.type === 'Identifier' ? node.property.name : undefined
}

function calleeRoot(node: Node): string | undefined {
  if (node.type === 'Identifier') return node.name

  if (node.type === 'MemberExpression') return calleeRoot(node.object)

  if (node.type === 'CallExpression') return calleeRoot(node.callee)

  return undefined
}

function testBody(node: Node) {
  if (node.type !== 'CallExpression') return undefined
  const root = calleeRoot(node.callee)

  if (root === undefined || !TEST_FUNCTIONS.has(root)) return undefined
  const callback = node.arguments.at(-1)

  return callback?.type === 'ArrowFunctionExpression' ||
    callback?.type === 'FunctionExpression'
    ? callback
    : undefined
}

interface Assertion {
  call: ESTree.CallExpression
  subject: Node
  matcher: string | undefined
  expected: Node[]
}

function assertionOf(
  node: Node,
  parents: Map<Node, Node>
): Assertion | undefined {
  if (node.type !== 'CallExpression') return undefined

  if (node.callee.type !== 'Identifier' || node.callee.name !== 'expect')
    return undefined
  const [subject] = node.arguments

  if (subject === undefined || subject.type === 'SpreadElement')
    return undefined
  let current: Node = node
  let parent = parents.get(current)

  while (parent?.type === 'MemberExpression' && parent.object === current) {
    const name = propertyName(parent)

    if (name === undefined || !MODIFIERS.has(name)) {
      const matcherCall = parents.get(parent)

      const expected =
        matcherCall?.type === 'CallExpression' && matcherCall.callee === parent
          ? matcherCall.arguments
          : []

      return {call: node, subject, matcher: name, expected}
    }

    current = parent
    parent = parents.get(current)
  }

  return {call: node, subject, matcher: undefined, expected: []}
}

function parentMap(root: Node) {
  const parents = new Map<Node, Node>()

  for (const node of walk(root))
    for (const child of children(node)) parents.set(child, node)

  return parents
}

/**
 * Each `const` binding, and whether it starts as an object literal. Arrays
 * don't count: a test hands `const seen = []` to a fake to record into.
 */
function literalBindings(root: Node, into: Map<string, boolean>) {
  for (const node of walk(root)) {
    if (node.type !== 'VariableDeclaration' || node.kind !== 'const') continue

    for (const declarator of node.declarations) {
      if (declarator.id.type !== 'Identifier') continue
      into.set(declarator.id.name, declarator.init?.type === 'ObjectExpression')
    }
  }

  return into
}

function isNameOnly(node: Node, parent: Node | undefined) {
  if (parent === undefined) return false

  if (parent.type === 'MemberExpression')
    return !parent.computed && parent.property === node

  if (parent.type === 'Property')
    return !parent.computed && !parent.shorthand && parent.key === node

  return parent.type === 'VariableDeclarator' && parent.id === node
}

/**
 * Bindings used anywhere but inside `expect(...)`: the unit may write any
 * binding it can reach, as it does a `ref`.
 */
function escaping(root: Node, parents: Map<Node, Node>) {
  const names = new Set<string>()

  for (const node of walk(root)) {
    if (node.type !== 'Identifier') continue

    if (isNameOnly(node, parents.get(node))) continue
    let top: Node = node
    let parent = parents.get(top)

    while (parent?.type === 'MemberExpression' && parent.object === top) {
      top = parent
      parent = parents.get(top)
    }

    const asserted =
      parent?.type === 'CallExpression' &&
      parent.arguments.some(argument => argument === top) &&
      calleeRoot(parent.callee) === 'expect'

    if (!asserted) names.add(node.name)
  }

  return names
}

function memberRoot(node: Node): Node {
  return node.type === 'MemberExpression' ? memberRoot(node.object) : node
}

function topLevelBindings(program: ESTree.Program) {
  const bindings = new Map<string, boolean>()

  for (const statement of program.body)
    if (statement.type === 'VariableDeclaration')
      literalBindings(statement, bindings)

  return bindings
}

/** Fixtures: object literals a test can see and uses only in assertions. */
function testsIn(program: ESTree.Program) {
  const parents = parentMap(program)
  const fileBindings = topLevelBindings(program)
  const fileEscaping = escaping(program, parents)
  const tests = []

  for (const node of walk(program)) {
    const body = testBody(node)

    if (!body) continue
    const assertions: Assertion[] = []

    for (const inner of walk(body)) {
      const assertion = assertionOf(inner, parents)

      if (assertion) assertions.push(assertion)
    }

    const local = literalBindings(body, new Map())
    const bodyEscaping = escaping(body, parents)
    const fixtures = new Map<string, boolean>()

    for (const [name, literal] of [...fileBindings, ...local]) {
      const used = local.has(name) ? bodyEscaping : fileEscaping
      fixtures.set(name, literal && !used.has(name))
    }

    tests.push({assertions, fixtures})
  }

  return tests
}

/** Built from literals and fixtures alone: nothing the unit produced. */
function isConstant(node: Node, fixtures: Map<string, boolean>): boolean {
  // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- only a handful of node kinds can be constant
  switch (node.type) {
    case 'Literal':
      return true
    case 'TemplateLiteral':
      return node.expressions.every(part => isConstant(part, fixtures))
    case 'UnaryExpression':
      return isConstant(node.argument, fixtures)
    case 'ArrayExpression':
      return node.elements.every(
        element => element === null || isConstant(element, fixtures)
      )
    case 'ObjectExpression':
      return node.properties.every(
        property =>
          property.type === 'Property' && isConstant(property.value, fixtures)
      )
    case 'MemberExpression':
      return !node.computed && isConstant(node.object, fixtures)
    case 'Identifier':
      return node.name === 'undefined' || fixtures.get(node.name) === true
    default:
      return false
  }
}

export const noFixtureAssertion: Rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Assert on what the unit produced, not on a test fixture.',
    },
    messages: {
      fixture:
        'This asserts on a value the test built, so it passes whatever the unit does. Assert on what the unit returned, rendered or called.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(program) {
        for (const {assertions, fixtures} of testsIn(program))
          for (const {call, subject, matcher, expected} of assertions) {
            if (matcher !== undefined && MOCK_MATCHER.test(matcher)) continue

            if (!expected.every(value => isConstant(value, fixtures))) continue
            const root = memberRoot(subject)

            if (root.type === 'Identifier' && fixtures.get(root.name) === true)
              context.report({node: call, messageId: 'fixture'})
          }
      },
    }
  },
})
