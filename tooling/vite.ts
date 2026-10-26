import type {Plugin, UserConfig} from 'vite'

import {builtinModules} from 'node:module'
import path from 'node:path'

import runtime from '../electron-runtime.json' with {type: 'json'}

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]

function major(version: string) {
  return version.split('.')[0]
}

/** Electron's own Chromium, so the renderer build down-levels nothing. */
export const chromeTarget = `chrome${major(runtime.chrome)}`

interface NodeBundleOptions {
  root: string
  entry: Record<string, string>
  format: 'es' | 'cjs'
  mode: string
  define?: Record<string, string>
  plugins?: Plugin[]
}

/** One fully bundled Node-side build (main, preload, Provider hosts, shell). */
export function nodeBundle({
  root,
  entry,
  format,
  mode,
  define = {},
  plugins = [],
}: NodeBundleOptions): UserConfig {
  const ext = format === 'es' ? 'mjs' : 'cjs'

  return {
    root,
    mode,
    plugins,
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        mode === 'production' ? 'production' : 'development'
      ),
      ...define,
    },
    resolve: {
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      conditions: ['node', 'module', 'development|production'],
    },
    build: {
      outDir: path.join(root, 'dist'),
      emptyOutDir: true,
      target: `node${major(runtime.node)}`,
      minify: false,
      sourcemap: true,
      copyPublicDir: false,
      lib: {
        entry,
        formats: [format],
        fileName: (_format, name) => `${name}.${ext}`,
      },
      rolldownOptions: {
        external: ['electron', ...nodeBuiltins],
        output: {chunkFileNames: `[name]-[hash].${ext}`},
      },
    },
  }
}

/**
 * A sandboxed preload can only `require('electron')`, so fail the build if the
 * bundle leans on anything else.
 */
export function selfContainedPreload(): Plugin {
  return {
    name: 'uz:self-contained-preload',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue

        const requires = chunk.code
          .matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)
          .map(match => match[2])
          .filter(id => id !== 'electron')
          .toArray()

        const dynamicImports = chunk.code.match(/\bimport\(/g) ?? []

        if (requires.length > 0 || dynamicImports.length > 0) {
          this.error(
            `${fileName} is not self-contained: ` +
              [
                ...requires.map(id => `require('${id}')`),
                ...dynamicImports.map(() => 'import()'),
              ].join(', ')
          )
        }
      }
    },
  }
}
