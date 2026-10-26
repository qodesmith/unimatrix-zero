/**
 * Electron picks the app's Node and Chromium. The build targets read them from
 * `electron-runtime.json`, so it must describe the installed Electron, and
 * `@types/node` must not describe a newer Node than the one Electron ships.
 */
import path from 'node:path'
import {z} from 'zod'

import runtime from '../electron-runtime.json'
import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')

const Versioned = z.looseObject({version: z.string()})

async function versionOf(packageJson: string) {
  return Versioned.parse(await Bun.file(path.join(root, packageJson)).json())
    .version
}

function majorMinor(version: string) {
  const [major = 0, minor = 0] = version.split('.').map(Number)

  return {major, minor}
}

const electron = await versionOf('node_modules/electron/package.json')
const nodeTypes = await versionOf('node_modules/@types/node/package.json')

const node = majorMinor(runtime.node)
const types = majorMinor(nodeTypes)

const problems: string[] = []

if (electron !== runtime.electron) {
  problems.push(
    `Electron is ${electron}, but electron-runtime.json describes ${runtime.electron}.`,
    'Run `bun run electron-runtime` to regenerate it and .node-version.'
  )
}

if (types.major !== node.major || types.minor > node.minor) {
  problems.push(
    `@types/node is ${nodeTypes}, but Electron ${runtime.electron} ships Node ${runtime.node}.`,
    `Pin @types/node to the newest ${node.major}.x at or below ${node.major}.${node.minor}. Node moves only when Electron does.`
  )
}

finishCheck(
  problems,
  'electron-runtime.json or @types/node is out of step with Electron:',
  `Electron ${electron} ships Node ${runtime.node}, and @types/node ${nodeTypes} fits it.`
)
