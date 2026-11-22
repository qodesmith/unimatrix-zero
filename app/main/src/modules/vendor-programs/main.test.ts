import path from 'node:path'
import {expect, it} from 'vitest'

import {
  DEV_MANIFEST,
  gitFolderFor,
  gitTargetFor,
  signInRequestFor,
} from './main'

const userData = path.join('/data', 'unimatrix-zero')

it('puts the exact Claude build under userData, beside its own configuration and, on a Mac, the app’s developer folder', () => {
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
    developerDir: path.join(userData, 'developer'),
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

it('puts the Codex folder for ChatGPT under userData, beside its own configuration and the folder of the app’s git wrapper, with no developer folder off a Mac', () => {
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
    gitFolder: path.join(userData, 'git'),
  })
})

it('puts the app’s own git under userData, with the other vendor programs, as the folder it unpacks to', () => {
  const target = gitTargetFor({userData, platform: 'win32', arch: 'x64'})

  expect(target?.path).toBe(
    path.join(
      userData,
      'vendor',
      'git',
      DEV_MANIFEST.vendorPrograms.git.version
    )
  )
  expect(target?.build.url).toMatch(/windows-x64\.tar\.gz$/)
})

it('has no git for a machine the manifest does not name', () => {
  expect(gitTargetFor({userData, platform: 'freebsd', arch: 'x64'})).toBeNull()
})

it('names the cmd folder of the app’s own git build to a vendor program on Windows', () => {
  const machine = {userData, platform: 'win32', arch: 'x64'} as const

  expect(signInRequestFor('claude', machine).gitFolder).toBe(
    path.join(gitTargetFor(machine)?.path ?? '', 'cmd')
  )
})

it('names no git folder on a Mac, or for a machine the manifest has no git for', () => {
  expect(gitFolderFor({userData, platform: 'darwin', arch: 'arm64'})).toBeNull()
  expect(
    gitFolderFor({userData, platform: 'linux', arch: 'riscv64'})
  ).toBeNull()
  expect(
    signInRequestFor('claude', {userData, platform: 'darwin', arch: 'arm64'})
  ).not.toHaveProperty('gitFolder')
})
