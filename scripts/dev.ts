import type {RolldownWatcher} from 'rolldown'

import {randomBytes} from 'node:crypto'
import path from 'node:path'
import {build, createServer} from 'vite'

import {checkoutHash, devDataFolderName} from './dev-data'
import {electronPath} from './electron-as-node'

const root = path.resolve(import.meta.dirname, '..')

const worktree = checkoutHash(root)

// fetch refuses the Fetch spec's "bad ports", so main can't proxy to Vite on
// one. These are the ones inside the ranges below.
const fetchBlockedPorts = new Set([
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

function worktreePort(base: number, span: number) {
  let port = base + (parseInt(worktree, 16) % span)

  while (fetchBlockedPorts.has(port)) port++

  return port
}

const vitePort = worktreePort(5173, 2000)
const debugPort = worktreePort(9222, 1000)
const fakeProvider = process.argv.includes('--fake')

// A fake connection saved in the real data would pass for a real one.
const dataFolder = devDataFolderName(root, fakeProvider)

const scriptNonce = randomBytes(16).toString('base64')

function fromRoot(relative: string) {
  return path.join(root, relative)
}

async function firstBuild(watcher: RolldownWatcher) {
  return new Promise<void>(resolve => {
    watcher.on('event', event => {
      if (event.code === 'BUNDLE_END') resolve()

      if (event.code === 'ERROR') console.error(event.error)
    })
  })
}

// Listen as soon as each watcher exists: a bundle can finish before the next
// watcher is created, and a late listener misses its BUNDLE_END.
const firstBuilds: Promise<void>[] = []

async function watchBundle(dir: string): Promise<RolldownWatcher> {
  const watcher = await build({
    configFile: path.join(dir, 'vite.config.ts'),
    mode: 'development',
    logLevel: 'warn',
    build: {watch: {}},
  })

  if (!('on' in watcher)) throw new Error(`${dir}: expected a watcher`)
  firstBuilds.push(firstBuild(watcher))

  return watcher
}

const vite = await createServer({
  configFile: fromRoot('app/renderer/vite.config.ts'),
  mode: 'development',
  logLevel: 'warn',
  server: {
    host: 'localhost',
    port: vitePort,
    strictPort: true,
    hmr: {host: 'localhost', port: vitePort},
  },
  html: {cspNonce: scriptNonce},
})

await vite.listen()

const bundles = {
  shell: await watchBundle(fromRoot('shell')),
  main: await watchBundle(fromRoot('app/main')),
  preload: await watchBundle(fromRoot('app/preload')),
  hosts: await watchBundle(fromRoot('app/provider-host')),
}

await Promise.all(firstBuilds)

let electron: ReturnType<typeof Bun.spawn> | null = null
let stopping = false

function startElectron() {
  electron = Bun.spawn(
    [
      electronPath,
      `--remote-debugging-port=${debugPort}`,
      fromRoot('shell/dist/index.cjs'),
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        UZ_DEV: '1',
        UZ_DEV_VITE_PORT: String(vitePort),
        UZ_DEV_NONCE: scriptNonce,
        UZ_DEV_DATA_FOLDER: dataFolder,
        UZ_DEV_FAKE: fakeProvider ? '1' : '0',
      },
      onExit: (_proc, code) => {
        if (stopping || restarting) return
        console.log(`Electron exited (${code}); stopping dev.`)
        void shutdown()
      },
    }
  )
}

let restarting = false

async function restartElectron(reason: string) {
  console.log(`${reason} rebuilt; restarting Electron.`)
  restarting = true
  electron?.kill()
  await electron?.exited
  restarting = false
  startElectron()
}

let restartTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRestart(reason: string) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    void restartElectron(reason)
  }, 300)
}

for (const [name, watcher] of Object.entries(bundles)) {
  watcher.on('event', event => {
    if (event.code !== 'BUNDLE_END') return

    scheduleRestart(name)
  })
}

async function shutdown() {
  stopping = true
  electron?.kill()
  await Promise.all(
    Object.values(bundles).map(async watcher => watcher.close())
  )
  await vite.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())

process.on('SIGTERM', () => void shutdown())

console.log(
  `Unimatrix Zero dev: renderer on app-dev:// (Vite :${vitePort}), CDP on :${debugPort}, data in ${dataFolder}${fakeProvider ? ', fake Provider' : ''}`
)

startElectron()
