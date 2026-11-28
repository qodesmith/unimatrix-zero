import type {ApprovalEvent} from '#modules/approvals/main'

import {createApprovals} from '#modules/approvals/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {
  actionOf,
  askOn,
  editDecision,
  permissionOptions,
  readDecision,
  sandboxSettings,
} from './permissions'
import {projectKeyOf} from './transcripts'

const made: string[] = []

afterEach(() => {
  vi.restoreAllMocks()

  for (const folder of made.splice(0)) {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

function treeFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-tree-'))
  made.push(folder)

  return folder
}

function trees() {
  const treesFolder = treeFolder()
  const tree = path.join(treesFolder, 'one')
  const other = path.join(treesFolder, 'two')
  fs.mkdirSync(tree)
  fs.mkdirSync(other)

  return {
    folders: {
      treeFolder: tree,
      treesFolder,
      hiddenFolders: [],
      configDir: treeFolder(),
    },
    treesFolder,
    tree,
    other,
  }
}

const CANT_BE_READ = 'This path is in a folder that can’t be read from here.'

it('asks about an edit in the Tree’s files by its full path, a relative one too, and one through the real path of the folder', () => {
  const tree = treeFolder()
  const real = fs.realpathSync(tree)

  expect(actionOf('Write', {file_path: 'notes.txt'}, tree)).toEqual({
    kind: 'edit',
    paths: [path.join(tree, 'notes.txt')],
    inTreeFiles: true,
  })
  expect(
    actionOf('Edit', {file_path: path.join(real, 'deep', 'a.md')}, tree)
  ).toMatchObject({inTreeFiles: true})
  expect(
    actionOf('NotebookEdit', {notebook_path: path.join(tree, 'a.ipynb')}, tree)
  ).toMatchObject({kind: 'edit', inTreeFiles: true})
})

it('asks about an edit outside the Tree’s files as one other Branches will see', () => {
  const tree = treeFolder()
  const zshrc = path.join(os.homedir(), '.zshrc')

  expect(actionOf('Write', {file_path: zshrc}, tree)).toEqual({
    kind: 'edit',
    paths: [zshrc],
    inTreeFiles: false,
  })
  expect(
    actionOf('Edit', {file_path: path.join(tree, '..', 'x.txt')}, tree)
  ).toMatchObject({inTreeFiles: false})
})

it('asks about an edit by a `~` path, or one with a space before it, as the file `claude` would write', () => {
  const tree = treeFolder()
  const home = treeFolder()
  vi.spyOn(os, 'homedir').mockReturnValue(home)

  expect(actionOf('Write', {file_path: '~/.zshrc'}, tree)).toEqual({
    kind: 'edit',
    paths: [path.join(home, '.zshrc')],
    inTreeFiles: false,
  })
  expect(
    actionOf('NotebookEdit', {notebook_path: ` ${home}/a.ipynb`}, tree)
  ).toEqual({
    kind: 'edit',
    paths: [path.join(home, 'a.ipynb')],
    inTreeFiles: false,
  })
})

it('asks about a command, a host, an MCP tool and any other tool by what each names', () => {
  const tree = treeFolder()

  expect(actionOf('Bash', {command: 'touch made.txt'}, tree)).toEqual({
    kind: 'command',
    command: 'touch made.txt',
  })
  expect(actionOf('PowerShell', {command: 'ni made.txt'}, tree)).toEqual({
    kind: 'command',
    command: 'ni made.txt',
  })
  expect(
    actionOf('WebFetch', {url: 'https://docs.example.com:8443/a?b'}, tree)
  ).toEqual({kind: 'host', host: 'docs.example.com'})
  expect(actionOf('mcp__linear_app__create_issue', {}, tree)).toEqual({
    kind: 'mcp-tool',
    server: 'linear_app',
    tool: 'create_issue',
  })
  expect(actionOf('WebSearch', {}, tree)).toEqual({
    kind: 'tool',
    name: 'WebSearch',
  })
})

it('asks about the retry of a command outside the Sandbox as that form alone, and about the Sandbox’s network prompt by its host', () => {
  const tree = treeFolder()

  expect(
    actionOf(
      'Bash',
      {command: 'touch ../made.txt', dangerouslyDisableSandbox: true},
      tree
    )
  ).toEqual({
    kind: 'command',
    command: 'touch ../made.txt',
    outsideSandbox: true,
  })
  expect(
    actionOf(
      'Bash',
      {command: 'touch made.txt', dangerouslyDisableSandbox: false},
      tree
    )
  ).toEqual({kind: 'command', command: 'touch made.txt'})
  expect(actionOf('SandboxNetworkAccess', {host: 'example.com'}, tree)).toEqual(
    {kind: 'host', host: 'example.com', fromCommand: true}
  )
})

it('denies the Sandbox’s network prompt that names no host, with no card and no grant, and still asks about one that names a host', async () => {
  const tree = treeFolder()
  const approvals = createApprovals()
  const events: ApprovalEvent[] = []

  const canUseTool = askOn(
    {
      current: approvals.forReply(
        {treeId: 'tree-1', replyId: 'reply-1', grants: [], treeFolder: tree},
        event => {
          events.push(event)
        }
      ),
    },
    tree
  )

  async function prompted(input: {host?: string | number}) {
    const asked = canUseTool('SandboxNetworkAccess', input, {
      signal: new AbortController().signal,
      toolUseID: 'prompt-1',
      requestId: 'request-1',
    })

    for (const event of events) {
      if (event.type === 'APPROVAL_REQUESTED') {
        approvals.answer(event.approvalId, 'always-allow')
      }
    }

    return await asked
  }

  const denied = [
    await prompted({}),
    await prompted({host: ''}),
    await prompted({host: 7}),
  ]

  expect(denied).toEqual(
    Array.from({length: 3}, () => ({
      behavior: 'deny',
      message: expect.stringContaining('no host'),
    }))
  )
  expect(events).toEqual([])

  await expect(prompted({host: 'example.com'})).resolves.toMatchObject({
    behavior: 'allow',
  })
  expect(events).toMatchObject([
    {type: 'APPROVAL_REQUESTED', action: {kind: 'host', host: 'example.com'}},
    {type: 'APPROVAL_RESOLVED', answer: 'always-allow'},
  ])
})

it('refuses a Read, a Glob and a Grep of another Tree’s files, by a relative path and a Glob pattern too, and lets through one of this Tree’s files or outside every Tree', () => {
  const {folders, tree, other} = trees()
  const beside = treeFolder()

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders).permissionDecision
  }

  expect([
    decided('Read', {file_path: path.join(other, 'secret.txt')}),
    decided('Read', {file_path: path.join('..', 'two', 'secret.txt')}),
    decided('Read', {file_path: path.join(fs.realpathSync(other), 'a.txt')}),
    decided('Glob', {pattern: '*.txt', path: other}),
    decided('Glob', {pattern: path.join(other, '**')}),
    decided('Glob', {pattern: path.join('*', '..', '..', 'two', '**')}),
    decided('Grep', {pattern: 'PLOVER', path: other}),
  ]).toEqual(Array.from({length: 7}, () => 'deny'))

  expect([
    decided('Read', {file_path: path.join(tree, 'notes.txt')}),
    decided('Read', {file_path: 'notes.txt'}),
    decided('Read', {file_path: path.join(os.homedir(), '.zshrc')}),
    decided('Glob', {pattern: '**/*.txt'}),
    decided('Glob', {pattern: '*.txt', path: tree}),
    decided('Glob', {pattern: path.join(tree, 'src', '{a,b}', '*.ts')}),
    decided('Glob', {pattern: '*.txt', path: beside}),
    decided('Grep', {pattern: '../two'}),
    decided('Grep', {pattern: 'PLOVER', path: beside}),
  ]).toEqual(Array.from({length: 9}, () => 'allow'))
})

it.runIf(fs.existsSync(os.tmpdir().toUpperCase()))(
  'refuses a Read, a Glob and a Grep of another Tree’s files through a folder’s name in another letter case, on a disk that ignores case',
  () => {
    const {folders, treesFolder} = trees()

    const other = path.join(
      path.dirname(treesFolder),
      path.basename(treesFolder).toUpperCase(),
      'two'
    )

    function decided(toolName: string, input: Record<string, string>) {
      return readDecision(toolName, input, folders).permissionDecision
    }

    expect([
      decided('Read', {file_path: path.join(other, 'secret.txt')}),
      decided('Glob', {pattern: '*.txt', path: other}),
      decided('Grep', {pattern: 'PLOVER', path: other}),
    ]).toEqual(['deny', 'deny', 'deny'])
  }
)

it('refuses a Read, a Glob and a Grep that reach another Tree through a `~` path or a path with a space before it', () => {
  const {folders, treesFolder, other} = trees()
  vi.spyOn(os, 'homedir').mockReturnValue(path.dirname(treesFolder))
  const fromHome = `~/${path.basename(treesFolder)}/two`

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders).permissionDecision
  }

  expect([
    decided('Read', {file_path: `${fromHome}/secret.txt`}),
    decided('Glob', {pattern: '*.txt', path: fromHome}),
    decided('Grep', {pattern: 'PLOVER', path: fromHome}),
    decided('Grep', {pattern: 'PLOVER', path: '~'}),
    decided('Read', {file_path: ` ${path.join(other, 'secret.txt')}`}),
    decided('Grep', {pattern: 'PLOVER', path: ` ${treesFolder}`}),
  ]).toEqual(Array.from({length: 6}, () => 'deny'))
})

it('refuses a Glob and a Grep that start at or above the folder of every Tree, by a pattern with a wildcard above it too, and tells the Model to search a narrower folder', () => {
  const {folders, treesFolder} = trees()
  const above = path.dirname(treesFolder)
  const {root} = path.parse(treesFolder)

  expect([
    readDecision('Grep', {pattern: 'PLOVER', path: treesFolder}, folders),
    readDecision('Grep', {pattern: 'PLOVER', path: above}, folders),
    readDecision('Grep', {pattern: 'PLOVER', path: root}, folders),
    readDecision('Glob', {pattern: '**/secret.txt', path: above}, folders),
    readDecision('Glob', {pattern: '**', path: root}, folders),
    readDecision('Glob', {pattern: path.join('..', '**')}, folders),
    readDecision('Glob', {pattern: path.join('..', '..', '*')}, folders),
    readDecision(
      'Glob',
      {pattern: path.join(above, 'uz-tr*', '**', 'secret.txt')},
      folders
    ),
    readDecision(
      'Glob',
      {pattern: path.join(above, `{${path.basename(treesFolder)},x}`, '**')},
      folders
    ),
  ]).toEqual(
    Array.from({length: 9}, () => ({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('narrower folder'),
    }))
  )
})

function withConfig() {
  const {folders, tree, other} = trees()
  const providers = path.join(treeFolder(), 'providers')
  const configDir = path.join(providers, 'claude')
  const projects = path.join(configDir, 'projects')
  const saved = path.join(projects, projectKeyOf(tree), 'session-1')
  const stores = treeFolder()
  fs.mkdirSync(path.join(saved, 'tool-results'), {recursive: true})
  fs.mkdirSync(path.join(projects, projectKeyOf(other), 'session-2'), {
    recursive: true,
  })

  return {
    folders: {...folders, hiddenFolders: [providers, stores], configDir},
    tree,
    other,
    providers,
    configDir,
    projects,
    saved,
    stores,
  }
}

it('lets through a Read of a tool’s output that claude saved for this Tree, by a real, a `~` or a space-led path too, and a Glob or a Grep inside its folder', () => {
  const {folders, saved} = withConfig()
  const output = path.join(saved, 'tool-results', 'b1.txt')
  fs.writeFileSync(output, 'HERON\n')
  vi.spyOn(os, 'homedir').mockReturnValue(path.dirname(folders.configDir))

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders).permissionDecision
  }

  const fromHome = `~/claude/${path.relative(folders.configDir, output)}`

  expect([
    decided('Read', {file_path: output}),
    decided('Read', {file_path: fs.realpathSync(output)}),
    decided('Read', {file_path: fromHome}),
    decided('Read', {file_path: ` ${output}`}),
    decided('Grep', {pattern: 'HERON', path: path.dirname(output)}),
    decided('Glob', {pattern: path.join(saved, 'tool-results', '*.txt')}),
  ]).toEqual(Array.from({length: 6}, () => 'allow'))
})

it.runIf(fs.existsSync(os.tmpdir().toUpperCase()))(
  'lets through a Read of a tool’s output that claude saved for this Tree when the Tree’s folder comes in another letter case, on a disk that ignores case',
  () => {
    const {folders, saved} = withConfig()
    const output = path.join(saved, 'tool-results', 'b1.txt')
    fs.writeFileSync(output, 'HERON\n')

    expect(
      readDecision(
        'Read',
        {file_path: output},
        {...folders, treeFolder: folders.treeFolder.toUpperCase()}
      ).permissionDecision
    ).toBe('allow')
  }
)

it('refuses a Read of claude’s config folder but this Tree’s saved outputs, another Tree’s sessions included, and of the other hidden folders, and tells the Model the folder can’t be read', () => {
  const {folders, other, providers, configDir, projects, saved, stores} =
    withConfig()

  const otherSaved = path.join(projects, projectKeyOf(other), 'session-2')
  vi.spyOn(os, 'homedir').mockReturnValue(path.dirname(configDir))

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders)
  }

  expect([
    decided('Read', {
      file_path: path.join(otherSaved, 'tool-results', 'b2.txt'),
    }),
    decided('Read', {file_path: path.join(saved, 'transcript.jsonl')}),
    decided('Read', {file_path: path.join(saved, '..', 'session-1.jsonl')}),
    decided('Read', {
      file_path: path.join(saved, 'tool-results', '..', '..', 'x.jsonl'),
    }),
    decided('Read', {file_path: path.join(configDir, '.claude.json')}),
    decided('Read', {file_path: '~/claude/.credentials.json'}),
    decided('Read', {file_path: ` ${path.join(configDir, '.claude.json')}`}),
    decided('Read', {file_path: path.join(providers, 'chatgpt', 'auth.json')}),
    decided('Read', {file_path: path.join(stores, 'one', 'HEAD')}),
    decided('Grep', {pattern: 'PLOVER', path: configDir}),
    decided('Grep', {pattern: 'PLOVER', path: projects}),
    decided('Grep', {pattern: 'PLOVER', path: path.dirname(saved)}),
    decided('Grep', {pattern: 'PLOVER', path: saved}),
    decided('Glob', {pattern: '**', path: projects}),
    decided('Glob', {pattern: path.join(configDir, '**', 'tool-results', '*')}),
    decided('Glob', {
      pattern: path.join(path.dirname(saved), '*', 'tool-results', '*'),
    }),
    decided('Glob', {
      pattern: path.join('..', '..', '..', '..', 'two', '**'),
      path: path.join(saved, 'tool-results'),
    }),
    decided('Grep', {pattern: 'PLOVER', path: stores}),
  ]).toEqual(
    Array.from({length: 18}, () => ({
      permissionDecision: 'deny',
      permissionDecisionReason: CANT_BE_READ,
    }))
  )
})

it('refuses a Glob and a Grep that start above a hidden folder, by a pattern with a wildcard above it too, and tells the Model to search a narrower folder', () => {
  const {folders, providers} = withConfig()
  const above = path.dirname(providers)

  expect([
    readDecision('Grep', {pattern: 'PLOVER', path: above}, folders),
    readDecision(
      'Glob',
      {pattern: path.join(above, 'prov*', 'claude', '**')},
      folders
    ),
  ]).toEqual(
    Array.from({length: 2}, () => ({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('narrower folder'),
    }))
  )
})

it('under Supervised, hides the hidden folder that holds claude’s config folder from commands, and leaves it out of the Read deny rules that hold the other hidden folders', () => {
  const {folders, providers, stores} = withConfig()

  const {sandbox, permissions} = sandboxSettings(
    {
      permissionMode: 'supervised',
      ...folders,
      vendorProgram: {program: null, configDir: folders.configDir},
    },
    'darwin'
  )

  expect(sandbox?.filesystem?.denyRead).toEqual(
    expect.arrayContaining([providers, stores])
  )
  expect(permissions?.deny).toContain(`Read(/${stores}/**)`)
  expect(permissions?.deny.filter(rule => rule.includes(providers))).toEqual([])
})

const CHANGED_ELSEWHERE =
  'This path is in a folder that can’t be changed from here.'

function hidden() {
  const {folders, ...paths} = trees()
  const appFolder = treeFolder()

  return {
    folders: {...folders, hiddenFolders: [appFolder]},
    ...paths,
    appFolder,
  }
}

it('refuses a Write, an Edit and a NotebookEdit into another Tree’s files or one of the app’s hidden folders, by a relative, a real, a `~` or a space-led path too, and tells the Model the folder can’t be changed', () => {
  const {folders, treesFolder, other, appFolder} = hidden()
  vi.spyOn(os, 'homedir').mockReturnValue(path.dirname(appFolder))
  const fromHome = `~/${path.basename(appFolder)}`

  function decided(toolName: string, input: Record<string, string>) {
    return editDecision(toolName, input, folders)
  }

  expect([
    decided('Write', {file_path: path.join(other, 'a.txt')}),
    decided('Edit', {file_path: path.join('..', 'two', 'a.txt')}),
    decided('NotebookEdit', {notebook_path: path.join(other, 'a.ipynb')}),
    decided('Write', {file_path: path.join(treesFolder, 'three', 'a.txt')}),
    decided('Edit', {file_path: ` ${path.join(other, 'a.txt')}`}),
    decided('Write', {file_path: path.join(appFolder, 'unimatrix.sqlite')}),
    decided('Edit', {
      file_path: path.join(fs.realpathSync(appFolder), 'deep', 'a.json'),
    }),
    decided('NotebookEdit', {notebook_path: `${fromHome}/a.ipynb`}),
    decided('Write', {file_path: ` ${fromHome}/a.txt`}),
  ]).toEqual(
    Array.from({length: 9}, () => ({
      permissionDecision: 'deny',
      permissionDecisionReason: CHANGED_ELSEWHERE,
    }))
  )
})

it('leaves an edit in this Tree’s files, outside every Tree or in a credential folder to its card', () => {
  const {folders, tree} = hidden()
  const beside = treeFolder()

  function decided(toolName: string, input: Record<string, string>) {
    return editDecision(toolName, input, folders)
  }

  expect([
    decided('Write', {file_path: 'notes.txt'}),
    decided('Edit', {file_path: path.join(tree, 'deep', 'a.md')}),
    decided('NotebookEdit', {notebook_path: path.join(tree, 'a.ipynb')}),
    decided('Write', {file_path: path.join(beside, 'x.txt')}),
    decided('Edit', {file_path: '~/.zshrc'}),
    decided('Write', {file_path: path.join(os.homedir(), '.ssh', 'config')}),
  ]).toEqual(Array.from({length: 6}, () => ({})))
})

it('under Supervised, has claude refuse an edit into another Tree before it asks, and ask about one in this Tree', async () => {
  const {folders, other, tree} = hidden()

  const {hooks} = permissionOptions(
    {
      permissionMode: 'supervised',
      ...folders,
      vendorProgram: {program: null, configDir: folders.configDir},
    },
    {current: null}
  )

  async function hookAnswer(toolName: string, filePath: string) {
    const answers = await Promise.all(
      (hooks?.PreToolUse ?? [])
        .filter(({matcher}) => matcher?.split('|').includes(toolName))
        .flatMap(matched => matched.hooks)
        .map(async hook =>
          hook(
            {
              hook_event_name: 'PreToolUse',
              session_id: 's',
              transcript_path: '/t',
              cwd: tree,
              tool_name: toolName,
              tool_input: {file_path: filePath},
              tool_use_id: 'u',
            },
            'u',
            {signal: new AbortController().signal}
          )
        )
    )

    return answers
  }

  expect(await hookAnswer('Write', path.join(other, 'a.txt'))).toEqual([
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: CHANGED_ELSEWHERE,
      },
    },
  ])
  expect(await hookAnswer('Write', path.join(tree, 'a.txt'))).toEqual([
    {hookSpecificOutput: {hookEventName: 'PreToolUse'}},
  ])
})
