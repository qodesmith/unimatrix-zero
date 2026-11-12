import {describe, expect, it} from 'vitest'

import {keychainServicesIn, planPrune, worktreesIn} from './dev-data.ts'

const appDataPath = '/Users/sam/Library/Application Support'

const KEPT = 'unimatrix-zero-dev-5ec60a61'
const KEPT_KEYCHAIN = 'Claude Code-credentials-26a01dfa'
const GONE = 'unimatrix-zero-dev-69af198d'
const GONE_KEYCHAIN = 'Claude Code-credentials-595e6bdb'
const GONE_FAKE = 'unimatrix-zero-dev-69af198d-fake'

describe('planPrune', () => {
  it('keeps both folders of every checkout and deletes every other dev folder', () => {
    const plan = planPrune({
      appDataPath,
      checkouts: ['/Users/sam/repos/uz'],
      appDataEntries: [
        KEPT,
        `${KEPT}-fake`,
        GONE,
        GONE_FAKE,
        'unimatrix-zero',
        'Code',
      ],
      keychainServices: [],
    })

    expect(plan.folders.map(folder => folder.name)).toEqual([GONE, GONE_FAKE])
  })

  it("pairs each deleted folder with its Claude Keychain entry, when there's one", () => {
    const plan = planPrune({
      appDataPath,
      checkouts: [],
      appDataEntries: [GONE, GONE_FAKE],
      keychainServices: [GONE_KEYCHAIN],
    })

    expect(plan.folders).toEqual([
      {name: GONE, keychain: GONE_KEYCHAIN},
      {name: GONE_FAKE, keychain: null},
    ])
  })

  it("lists the Claude Keychain entries no dev folder owns, never the maintainer's own or another program's", () => {
    const plan = planPrune({
      appDataPath,
      checkouts: ['/Users/sam/repos/uz'],
      appDataEntries: [KEPT, GONE],
      keychainServices: [
        'Claude Code-credentials',
        KEPT_KEYCHAIN,
        GONE_KEYCHAIN,
        'Claude Code-credentials-481182c6',
        'Codex Auth',
      ],
    })

    expect(plan.unmatched).toEqual(['Claude Code-credentials-481182c6'])
  })
})

describe('worktreesIn', () => {
  it('reads every checkout path from `git worktree list --porcelain`', () => {
    const porcelain = [
      'worktree /Users/sam/repos/uz',
      'HEAD 96bdd7ed9733b57bafed64ba29b4a2b7fa3a7cc5',
      'branch refs/heads/main',
      '',
      'worktree /Users/sam/repos/uz/235 prune',
      'HEAD 773a8358b0711baf58233e345eb1030f9352c7f9',
      'detached',
      '',
    ].join('\n')

    expect(worktreesIn(porcelain)).toEqual([
      '/Users/sam/repos/uz',
      '/Users/sam/repos/uz/235 prune',
    ])
  })
})

describe('keychainServicesIn', () => {
  it("reads each item's service from `security dump-keychain`", () => {
    const dump = [
      'keychain: "/Users/sam/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      'attributes:',
      '    0x00000007 <blob>="Claude Code-credentials-595e6bdb"',
      '    "acct"<blob>="sam"',
      '    "svce"<blob>="Claude Code-credentials-595e6bdb"',
      'keychain: "/Users/sam/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      'attributes:',
      '    "svce"<blob>=<NULL>',
      'keychain: "/Users/sam/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      'attributes:',
      '    "svce"<blob>="Claude Code-credentials"',
    ].join('\n')

    expect(keychainServicesIn(dump)).toEqual([
      'Claude Code-credentials-595e6bdb',
      'Claude Code-credentials',
    ])
  })
})
