import {describe, expect, it} from 'vitest'

import {HOST_PACKAGE, MANIFEST, bumpOf} from './vendor-pins.ts'

interface Tree {
  claude: string
  codex: string
  sdk: string
  other?: string
}

function files(tree: Tree) {
  const manifest = {
    vendorPrograms: {
      claude: {version: tree.claude, builds: {}},
      codex: {version: tree.codex, builds: {}},
    },
  }

  const hostPackage = {
    dependencies: {
      '@anthropic-ai/claude-agent-sdk': tree.sdk,
      zod: tree.other ?? '^4.0.0',
    },
  }

  return new Map([
    [MANIFEST, JSON.stringify(manifest)],
    [HOST_PACKAGE, JSON.stringify(hostPackage)],
  ])
}

const PINNED: Tree = {claude: '2.1.307', codex: '0.163.0', sdk: '0.3.307'}

function repo(head: Tree) {
  const trees = new Map([
    ['fork-point', PINNED],
    ['head', head],
  ])

  return async (call: string) => {
    if (call === 'repos/o/r/compare/main-tip...head') {
      return JSON.stringify({merge_base_commit: {sha: 'fork-point'}})
    }

    const [, file = '', ref = ''] =
      /^repos\/o\/r\/contents\/(.+)\?ref=(.+)$/.exec(call) ?? []

    const tree = trees.get(ref)
    const content = tree && files(tree).get(file)

    if (content === undefined) throw new Error(`Unexpected call: ${call}`)

    return JSON.stringify({content: Buffer.from(content).toString('base64')})
  }
}

const pr = {base: 'main-tip', head: 'head'}

describe('a bump PR', () => {
  it('is one that moves a vendor program’s version from where it branched', async () => {
    const head = {...PINNED, claude: '2.1.322', codex: '0.170.0'}

    await expect(bumpOf(repo(head), 'o/r', pr)).resolves.toEqual([
      'claude 2.1.307 → 2.1.322',
      'codex 0.163.0 → 0.170.0',
    ])
  })

  it('is one that moves the Agent SDK', async () => {
    const head = {...PINNED, sdk: '0.3.322', other: '^4.1.0'}

    await expect(bumpOf(repo(head), 'o/r', pr)).resolves.toEqual([
      '@anthropic-ai/claude-agent-sdk 0.3.307 → 0.3.322',
    ])
  })

  it('isn’t one that edits the pin files without moving a pin', async () => {
    const head = {...PINNED, other: '^4.1.0'}

    await expect(bumpOf(repo(head), 'o/r', pr)).resolves.toEqual([])
  })
})
