import {parseSync} from 'oxc-parser'
import {describe, expect, it} from 'vitest'

import plugin from './only-export-components'

/**
 * Drives the rule the way Oxlint does: parse a fixture, hand the resulting
 * `Program` to the visitor `create` returns, and collect the reported
 * messageIds. `sourceCode.getScope` is only consulted for re-exported classes,
 * which none of these fixtures use, so we leave `sourceCode` unset.
 */
const lint = (
  filename: string,
  code: string,
  options: readonly unknown[] = []
): string[] => {
  const {program} = parseSync(filename, code)
  const reported: string[] = []
  const context = {
    options,
    filename,
    report: (descriptor: {messageId: string}) => {
      reported.push(descriptor.messageId)
    },
  }
  const visitor = plugin.rules['only-export-components'].create(
    // The rule's local RuleContext is a private alpha type; this mock covers
    // exactly the members it touches.
    context as never
  ) as {Program?: (program: unknown) => void}
  visitor.Program?.(program)
  return reported
}

describe('custom/only-export-components', () => {
  // (a) A normal component file that mixes a component with a non-component
  // export should still be flagged.
  it('flags a component file with a non-component named export', () => {
    const reported = lint(
      'component.tsx',
      [
        'export const Widget = () => <div />',
        'export const helper = () => 42',
      ].join('\n')
    )
    expect(reported).toContain('namedExport')
  })

  it('does not flag a file that only exports components', () => {
    const reported = lint(
      'clean.tsx',
      [
        'export const Widget = () => <div />',
        'export const Panel = () => <div />',
      ].join('\n')
    )
    expect(reported).toEqual([])
  })

  // (b) A real TanStack route co-locates a non-component `Route` export with its
  // component; that pattern is intentionally exempted.
  it('skips a TanStack route module (export const Route = createFileRoute(...))', () => {
    const reported = lint(
      'src/routes/index.tsx',
      [
        "import {createFileRoute} from '@tanstack/react-router'",
        "export const Route = createFileRoute('/')({component: Home})",
        'function Home() {',
        '  return <div />',
        '}',
      ].join('\n')
    )
    expect(reported).toEqual([])
  })

  it('skips a curried code-based route (createRootRouteWithContext<T>()(...))', () => {
    const reported = lint(
      'router.tsx',
      [
        "import {createRootRouteWithContext} from '@tanstack/react-router'",
        'const rootRoute = createRootRouteWithContext<Ctx>()({component: Shell})',
        'export const helper = () => 42',
        'function Shell() {',
        '  return <div />',
        '}',
      ].join('\n')
    )
    expect(reported).toEqual([])
  })

  // (c) DECOY / KNOWN LIMITATION: a file that is *not* a route but happens to
  // initialize a top-level binding with a `create*Route*`-named call (here a
  // local helper) is silently exempted too. `definesTanStackRoute` is
  // content-based and does not resolve imports, so it cannot tell this apart
  // from a real route. This test pins the current (asymmetric, quiet) behavior;
  // if detection is ever tightened, update the expectation to `['namedExport']`.
  it('KNOWN LIMITATION: a decoy calling a create*Route* helper is silently skipped', () => {
    const reported = lint(
      'not-a-route.tsx',
      [
        "import {createRoute} from './my-router-helpers'",
        "export const config = createRoute({path: '/x'})",
        'export const Widget = () => <div />',
      ].join('\n')
    )
    // Without the decoy call this file would report `namedExport`; instead the
    // whole file goes dark.
    expect(reported).toEqual([])
  })
})
