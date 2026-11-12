import {describe, expect, it} from 'vitest'

import {bumpOf} from './vendor-pins.ts'

const MANIFEST = 'app/main/src/modules/vendor-programs/dev-manifest.json'
const HOST_PACKAGE = 'app/provider-host/package.json'

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

/** A repo where `head` branched off `fork-point` and changed `changed`. */
function repo(head: Tree, changed: string[]) {
  const trees = new Map([
    ['fork-point', PINNED],
    ['head', head],
  ])

  return async (call: string) => {
    if (call === 'repos/o/r/compare/main-tip...head') {
      return JSON.stringify({
        merge_base_commit: {sha: 'fork-point'},
        files: changed.map(filename => ({filename})),
      })
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

    await expect(bumpOf(repo(head, [MANIFEST]), 'o/r', pr)).resolves.toEqual([
      'claude 2.1.307 → 2.1.322',
      'codex 0.163.0 → 0.170.0',
    ])
  })

  it('is one that moves the Agent SDK, even inside other changes', async () => {
    const head = {...PINNED, sdk: '0.3.322', other: '^4.1.0'}

    await expect(
      bumpOf(repo(head, ['README.md', HOST_PACKAGE]), 'o/r', pr)
    ).resolves.toEqual(['@anthropic-ai/claude-agent-sdk 0.3.307 → 0.3.322'])
  })

  it('isn’t one that edits the pin files without moving a pin', async () => {
    const head = {...PINNED, other: '^4.1.0'}

    await expect(
      bumpOf(repo(head, [MANIFEST, HOST_PACKAGE]), 'o/r', pr)
    ).resolves.toEqual([])
  })

  it('isn’t one that leaves the pin files alone, without reading them', async () => {
    const head = {...PINNED, claude: 'unread'}

    await expect(bumpOf(repo(head, ['README.md']), 'o/r', pr)).resolves.toEqual(
      []
    )
  })
})
