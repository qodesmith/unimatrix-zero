import path from 'node:path'
import {expect, it} from 'vitest'

import {DEV_MANIFEST, signInRequestFor} from './main'

const userData = path.join('/data', 'unimatrix-zero')

it('names one Claude build for each OS and arch the app ships on', () => {
  expect(
    Object.keys(DEV_MANIFEST.vendorPrograms.claude.builds).toSorted()
  ).toEqual([
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-arm64',
    'win32-x64',
  ])
})

it('puts the exact Claude build under userData, beside its own configuration', () => {
  const request = signInRequestFor('claude', {
    userData,
    platform: 'darwin',
    arch: 'arm64',
  })

  expect(request).toEqual({
    program: {
      path: path.join(userData, 'vendor', 'claude', '2.1.307', 'claude'),
      build: DEV_MANIFEST.vendorPrograms.claude.builds['darwin-arm64'],
    },
    configDir: path.join(userData, 'providers', 'claude'),
  })
})

it('names the Windows build claude.exe', () => {
  const request = signInRequestFor('claude', {
    userData,
    platform: 'win32',
    arch: 'x64',
  })

  expect(request.program?.path).toBe(
    path.join(userData, 'vendor', 'claude', '2.1.307', 'claude.exe')
  )
  expect(request.program?.build.url).toMatch(/win32-x64\/claude\.exe$/)
})

it('has no program for a machine the manifest does not name', () => {
  expect(
    signInRequestFor('claude', {userData, platform: 'freebsd', arch: 'x64'})
      .program
  ).toBeNull()
})

it('names one Codex folder for each OS and arch, run from its app-server', () => {
  const {builds} = DEV_MANIFEST.vendorPrograms.codex

  expect(Object.keys(builds).toSorted()).toEqual(
    Object.keys(DEV_MANIFEST.vendorPrograms.claude.builds).toSorted()
  )

  for (const [platform, build] of Object.entries(builds)) {
    const exe = platform.startsWith('win32') ? '.exe' : ''

    expect(build.archive).toEqual({
      format: 'tar.gz',
      entrypoint: `bin/codex-app-server${exe}`,
    })
  }
})

it('puts the Codex folder for ChatGPT under userData, beside its own configuration', () => {
  const request = signInRequestFor('chatgpt', {
    userData,
    platform: 'linux',
    arch: 'x64',
  })

  expect(request).toEqual({
    program: {
      path: path.join(userData, 'vendor', 'chatgpt', '0.163.0'),
      build: DEV_MANIFEST.vendorPrograms.codex.builds['linux-x64'],
    },
    configDir: path.join(userData, 'providers', 'chatgpt'),
  })
})
