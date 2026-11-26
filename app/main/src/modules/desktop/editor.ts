import path from 'node:path'

/** Run as `program ...args <file>`. */
export interface Editor {
  name: string
  program: string
  args: string[]
}

export interface EditorLookup {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  exists: (file: string) => boolean
}

/** In the order they are offered, first found first. */
const MAC_EDITORS = [
  'Visual Studio Code',
  'Cursor',
  'Zed',
  'Sublime Text',
  'BBEdit',
  'Nova',
  'TextMate',
  'VSCodium',
]

const LINUX_EDITORS = [
  ['code', 'Visual Studio Code'],
  ['zed', 'Zed'],
  ['subl', 'Sublime Text'],
] as const

function macEditor({home, exists}: EditorLookup): Editor | null {
  for (const name of MAC_EDITORS) {
    for (const folder of [
      '/Applications',
      path.posix.join(home, 'Applications'),
    ]) {
      const app = path.posix.join(folder, `${name}.app`)

      if (exists(app)) return {name, program: 'open', args: ['-a', app]}
    }
  }

  return null
}

function windowsEditor({env, exists}: EditorLookup): Editor | null {
  const installs = [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'),
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
  ]

  for (const folder of installs) {
    const program =
      folder && path.win32.join(folder, 'Microsoft VS Code', 'Code.exe')

    if (program && exists(program)) {
      return {name: 'Visual Studio Code', program, args: []}
    }
  }

  return null
}

function linuxEditor({env, exists}: EditorLookup): Editor | null {
  const folders = (env.PATH ?? '').split(':').filter(Boolean)

  for (const [command, name] of LINUX_EDITORS) {
    for (const folder of folders) {
      const program = path.posix.join(folder, command)

      if (exists(program)) return {name, program, args: []}
    }
  }

  return null
}

export function detectEditor(lookup: EditorLookup): Editor | null {
  if (lookup.platform === 'darwin') return macEditor(lookup)

  return lookup.platform === 'win32'
    ? windowsEditor(lookup)
    : linuxEditor(lookup)
}
