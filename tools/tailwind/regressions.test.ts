import type {CanonicalRegression, HistoryReader} from './regressions'

import {afterEach, describe, expect, it} from 'vitest'

import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  findCanonicalRegressions,
  formatRegressionsMarkdown,
  formatRegressionsText,
  gitHistoryReader,
} from './regressions'

const fixtureRoot = path.join(import.meta.dirname, 'fixtures', 'radius')
const script = path.join(import.meta.dirname, 'check-regressions.ts')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {recursive: true, force: true})
  }
})

function git(dir: string, ...args: string[]): void {
  const proc = Bun.spawnSync(
    ['git', '-c', 'user.name=test', '-c', 'user.email=test@test', ...args],
    {
      cwd: dir,
      // Blank out host-level config (signing, hooks) for reproducibility.
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    }
  )

  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`)
  }
}

function commitAll(dir: string): void {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
}

/** Copies the radius fixture into a fresh git repo with one base commit. */
function initRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-reg-'))

  tempDirs.push(dir)
  cpSync(fixtureRoot, dir, {recursive: true})
  git(dir, 'init', '-q', '-b', 'main')
  commitAll(dir)

  return dir
}

/** Replaces the first occurrence of `from` in src/box.tsx. */
function editBox(dir: string, from: string, to: string): void {
  const file = path.join(dir, 'src', 'box.tsx')

  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to))
}

const baseBox = readFileSync(path.join(fixtureRoot, 'src', 'box.tsx'), 'utf8')

/**
 * In-memory HistoryReader: `base` and `head` map project-relative paths to
 * file text. Changed = present in head with different text (deletions are
 * excluded, mirroring `--diff-filter=d`).
 */
function inMemoryHistory(
  base: Record<string, string>,
  head: Record<string, string>
): HistoryReader {
  return {
    changedFiles: async () =>
      Object.keys(head).filter(file => base[file] !== head[file]),
    readBaseFile: async file => base[file] ?? null,
    readHeadFile: async file => head[file] ?? '',
  }
}

const checkHistory = async (
  base: Record<string, string>,
  head: Record<string, string>
): Promise<CanonicalRegression[]> =>
  findCanonicalRegressions({
    projectRoot: fixtureRoot,
    history: inMemoryHistory(base, head),
  })

describe('findCanonicalRegressions', () => {
  it('flags a hand-applied suggestion that regresses at runtime', async () => {
    const base = {'src/box.tsx': baseBox}
    const head = {
      'src/box.tsx': baseBox.replace('rounded-[4px]', 'rounded-lg'),
    }

    expect(await checkHistory(base, head)).toEqual([
      {
        file: 'src/box.tsx',
        from: 'rounded-[4px]',
        to: 'rounded-lg',
        reason:
          'css mismatch:\n' +
          '  OLD: { border-radius: 0.25rem; }\n' +
          '  NEW: { border-radius: 0.625rem; }',
      },
    ])
  })

  it('accepts a hand-applied suggestion that is CSS-equivalent', async () => {
    const base = {'src/box.tsx': baseBox}
    const head = {
      'src/box.tsx': baseBox.replace('rounded-[2px]', 'rounded-xs'),
    }

    expect(await checkHistory(base, head)).toEqual([])
  })

  it('ignores intentional redesigns to unrelated classes', async () => {
    const base = {'src/box.tsx': baseBox}
    const head = {'src/box.tsx': baseBox.replace('rounded-[4px]', 'p-2')}

    expect(await checkHistory(base, head)).toEqual([])
  })

  it('ignores plain removals', async () => {
    const base = {'src/box.tsx': baseBox}
    const head = {
      'src/box.tsx': baseBox.replace(
        '<span className="rounded-[4px]">x</span>',
        ''
      ),
    }

    expect(await checkHistory(base, head)).toEqual([])
  })

  it('ignores new files that use the canonical class', async () => {
    const base = {'src/box.tsx': baseBox}
    const head = {
      'src/box.tsx': baseBox,
      'src/new.tsx':
        'export const New = () => <div className="rounded-lg" />\n',
    }

    expect(await checkHistory(base, head)).toEqual([])
  })

  it('ignores deleted files', async () => {
    const base = {'src/box.tsx': baseBox}

    expect(await checkHistory(base, {})).toEqual([])
  })

  it('catches a partial swap while other occurrences remain', async () => {
    const twoSpans = baseBox.replace(
      '<span className="rounded-[4px]">x</span>',
      '<span className="rounded-[4px]">x</span>' +
        '<i className="rounded-[4px]">y</i>'
    )
    // Only one of the two occurrences gets the unsafe rewrite.
    const base = {'src/box.tsx': twoSpans}
    const head = {
      'src/box.tsx': twoSpans.replace('rounded-[4px]', 'rounded-lg'),
    }

    const regressions = await checkHistory(base, head)

    expect(regressions).toHaveLength(1)
    expect(regressions[0].from).toBe('rounded-[4px]')
    expect(regressions[0].to).toBe('rounded-lg')
  })

  it('catches variant-wrapped rewrites', async () => {
    const hoverBox = baseBox.replace('rounded-[4px]', 'hover:rounded-[4px]')
    const base = {'src/box.tsx': hoverBox}
    const head = {
      'src/box.tsx': hoverBox.replace(
        'hover:rounded-[4px]',
        'hover:rounded-lg'
      ),
    }

    const regressions = await checkHistory(base, head)

    expect(regressions).toHaveLength(1)
    expect(regressions[0].from).toBe('hover:rounded-[4px]')
    expect(regressions[0].to).toBe('hover:rounded-lg')
  })

  it('throws on an unknown base ref', async () => {
    const dir = initRepo()

    await expect(
      findCanonicalRegressions({projectRoot: dir, baseRef: 'no-such-ref'})
    ).rejects.toThrow('git diff against no-such-ref failed')
  })
})

// The in-memory fake re-encodes the diff semantics, so the real adapter's
// git quirks (`--diff-filter=d`, `./`-scoped `git show`) get their own
// coverage against actual repos.
describe('gitHistoryReader', () => {
  it('lists modified and added files but excludes deletions', async () => {
    const dir = initRepo()

    rmSync(path.join(dir, 'src', 'box.tsx'))
    writeFileSync(path.join(dir, 'src', 'new.tsx'), 'export const x = 1\n')
    // Untracked files never show in `git diff`; stage the addition the way a
    // committed PR head would present it.
    git(dir, 'add', 'src/new.tsx')

    const history = gitHistoryReader({projectRoot: dir, baseRef: 'HEAD'})

    expect(await history.changedFiles()).toEqual(['src/new.tsx'])
  })

  it('reads base text, and null for files new in head', async () => {
    const dir = initRepo()
    const newText = 'export const x = 1\n'

    writeFileSync(path.join(dir, 'src', 'new.tsx'), newText)

    const history = gitHistoryReader({projectRoot: dir, baseRef: 'HEAD'})

    expect(await history.readBaseFile('src/box.tsx')).toBe(baseBox)
    expect(await history.readBaseFile('src/new.tsx')).toBeNull()
    expect(await history.readHeadFile('src/new.tsx')).toBe(newText)
  })
})

describe('report formatting', () => {
  const regression: CanonicalRegression = {
    file: 'src/box.tsx',
    from: 'rounded-[4px]',
    to: 'rounded-lg',
    reason: 'css mismatch:\n  OLD: a\n  NEW: b',
  }

  it('formats a text report', () => {
    expect(formatRegressionsText([regression])).toBe(
      [
        '1 canonicalization regression(s):',
        '',
        'src/box.tsx: rounded-[4px] => rounded-lg',
        '  css mismatch:',
        '  OLD: a',
        '  NEW: b',
      ].join('\n')
    )
  })

  it('reports a clean diff in text mode', () => {
    expect(formatRegressionsText([])).toBe(
      'no canonicalization regressions found'
    )
  })

  it('formats a markdown table row per regression', () => {
    const report = formatRegressionsMarkdown([regression])

    expect(report).toContain('### Unsafe Tailwind canonicalizations')
    expect(report).toContain('| File | Applied change | Why it regresses |')
    expect(report).toContain(
      '| `src/box.tsx` | `rounded-[4px]` → `rounded-lg` | ' +
        '`css mismatch:`<br>`OLD: a`<br>`NEW: b` |'
    )
  })

  it('returns an empty markdown string for a clean diff', () => {
    expect(formatRegressionsMarkdown([])).toBe('')
  })
})

describe('check-regressions CLI', () => {
  async function runCli(cwd: string, ...args: string[]) {
    const proc = Bun.spawn(['bun', script, '--base', 'HEAD', ...args], {
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

  it('exits 0 with a clean message when the diff is safe', async () => {
    const dir = initRepo()

    editBox(dir, 'rounded-[2px]', 'rounded-xs')
    const {stdout, exitCode} = await runCli(dir)

    expect(exitCode).toBe(0)
    expect(stdout).toContain('no canonicalization regressions found')
  })

  it('exits 1 and reports the pair on a regression', async () => {
    const dir = initRepo()

    editBox(dir, 'rounded-[4px]', 'rounded-lg')
    const {stdout, exitCode} = await runCli(dir)

    expect(exitCode).toBe(1)
    expect(stdout).toContain('rounded-[4px] => rounded-lg')
  })

  it('--markdown prints the PR-comment report and exits 1', async () => {
    const dir = initRepo()

    editBox(dir, 'rounded-[4px]', 'rounded-lg')
    const {stdout, exitCode} = await runCli(dir, '--markdown')

    expect(exitCode).toBe(1)
    expect(stdout).toContain('### Unsafe Tailwind canonicalizations')
  })

  it('--markdown prints nothing and exits 0 when clean', async () => {
    const dir = initRepo()
    const {stdout, exitCode} = await runCli(dir, '--markdown')

    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
  })
})
