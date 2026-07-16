import {afterEach, describe, expect, it} from 'vitest'

/**
 * End-to-end CLI tests: run the real entry point with Bun against a temp
 * copy of the basic fixture, the way a developer or CI would.
 */
import {cpSync, mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const script = path.join(import.meta.dirname, 'canonicalize-classes.ts')
const fixtureRoot = path.join(import.meta.dirname, 'fixtures', 'basic')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {recursive: true, force: true})
  }
})

function copyFixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-cli-'))

  tempDirs.push(dir)
  cpSync(fixtureRoot, dir, {recursive: true})

  return dir
}

async function runCli(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['bun', script, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {stdout, stderr, exitCode}
}

describe('canonicalize-classes CLI', () => {
  it('dry-runs by default: prints the report without touching files', async () => {
    const root = copyFixture()
    const before = await Bun.file(path.join(root, 'src', 'button.tsx')).text()
    const {stdout, exitCode} = await runCli(root)

    expect(exitCode).toBe(0)
    expect(stdout).toContain('=== VERIFIED MAPPING (7) ===')
    expect(stdout).toContain('w-[16px] => w-4')
    expect(stdout).toContain('=== REJECTED (1) ===')
    expect(stdout).toContain('(dry run — pass --apply to write changes)')

    expect(await Bun.file(path.join(root, 'src', 'button.tsx')).text()).toBe(
      before
    )
  })

  it('--apply writes the fixes and lists the updated files', async () => {
    const root = copyFixture()
    const {stdout, exitCode} = await runCli(root, '--apply')

    expect(exitCode).toBe(0)
    expect(stdout).toContain(`updated: ${path.join('src', 'button.tsx')}`)
    expect(stdout).toContain(`updated: ${path.join('src', 'card.tsx')}`)
    expect(stdout).toContain(`updated: ${path.join('src', 'util.ts')}`)
    expect(stdout).toContain('applied to 3 files')

    const button = await Bun.file(path.join(root, 'src', 'button.tsx')).text()
    expect(button).toContain("cn('flex w-4', active && 'p-2')")
  })

  it('--markdown prints the PR-comment report when fixes exist', async () => {
    const root = copyFixture()
    const {stdout, exitCode} = await runCli(root, '--markdown')

    expect(exitCode).toBe(0)
    expect(stdout).toContain('### Non-canonical Tailwind classes')
    expect(stdout).toContain('| `w-[16px]` | `w-4` |')
    expect(stdout).toContain('suggestion(s) rejected')
  })

  it('--markdown prints nothing once everything is canonical', async () => {
    const root = copyFixture()

    await runCli(root, '--apply')
    const {stdout, exitCode} = await runCli(root, '--markdown')

    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
  })
})

describe('module exports', () => {
  it('re-exports the pipeline API', async () => {
    const mod = await import('./canonicalize-classes')

    expect(typeof mod.analyzeTailwindClasses).toBe('function')
    expect(typeof mod.applyCanonicalFixes).toBe('function')
    expect(typeof mod.formatTextReport).toBe('function')
    expect(typeof mod.formatMarkdownReport).toBe('function')
  })
})
