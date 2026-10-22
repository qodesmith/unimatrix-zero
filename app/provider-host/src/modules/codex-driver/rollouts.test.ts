import type {AppServer} from './app-server'
import type {Method, ParamsOf, ResponseOf} from './wire'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, expect, it} from 'vitest'

import {readRollouts, writeRolloutsBack} from './rollouts'
import {RESPONSES} from './wire'

let home: string

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uz-rollouts-')))
})

afterEach(() => {
  fs.rmSync(home, {recursive: true, force: true})
})

function rollout(name: string, text: string) {
  const file = path.join(home, 'sessions', '2026', '10', '22', name)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)

  return file
}

/** An app-server that reads threads from `threads`. */
function reading(
  threads: Record<string, {path: string | null; forkedFromId: string | null}>
) {
  const server: Pick<AppServer, 'request'> = {
    async request<M extends Method>(method: M, params: ParamsOf<M>) {
      const {threadId} = params as {threadId: string}
      const thread = threads[threadId]

      if (!thread) throw new Error(`no rollout found for thread id ${threadId}`)

      return RESPONSES[method].parse({
        thread: {id: threadId, ...thread},
      }) as ResponseOf<M>
    },
  }

  return server
}

it('keeps a fork’s rollout and every ancestor’s it points into', async () => {
  const grandparent = rollout('rollout-a.jsonl', 'a')
  const parent = rollout('rollout-b.jsonl.zst', 'b')
  const fork = rollout('rollout-c.jsonl', 'c')

  const server = reading({
    c: {path: fork, forkedFromId: 'b'},
    b: {path: parent, forkedFromId: 'a'},
    a: {path: grandparent, forkedFromId: null},
  })

  expect(await readRollouts(server, home, 'c')).toEqual([
    {path: 'sessions/2026/10/22/rollout-c.jsonl', base64: btoa('c')},
    {path: 'sessions/2026/10/22/rollout-b.jsonl.zst', base64: btoa('b')},
    {path: 'sessions/2026/10/22/rollout-a.jsonl', base64: btoa('a')},
  ])
})

it('keeps nothing outside CODEX_HOME', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-outside-'))
  const file = path.join(outside, 'rollout-x.jsonl')
  fs.writeFileSync(file, 'x')

  try {
    const server = reading({x: {path: file, forkedFromId: null}})

    expect(await readRollouts(server, home, 'x')).toEqual([])
  } finally {
    fs.rmSync(outside, {recursive: true, force: true})
  }
})

it('writes each rollout back under its own name', () => {
  writeRolloutsBack(home, [
    {path: 'sessions/2026/10/22/rollout-c.jsonl', base64: btoa('c')},
    {path: 'sessions/2026/10/21/rollout-a.jsonl.zst', base64: btoa('a')},
  ])

  expect(
    fs.readFileSync(
      path.join(home, 'sessions', '2026', '10', '22', 'rollout-c.jsonl'),
      'utf8'
    )
  ).toBe('c')
  expect(
    fs.existsSync(
      path.join(home, 'sessions', '2026', '10', '21', 'rollout-a.jsonl.zst')
    )
  ).toBe(true)
})

it('leaves out a compressed rollout Codex has since rewritten plain', () => {
  writeRolloutsBack(home, [
    {path: 'sessions/rollout-c.jsonl.zst', base64: btoa('old')},
    {path: 'sessions/rollout-c.jsonl', base64: btoa('new')},
  ])

  expect(fs.readdirSync(path.join(home, 'sessions'))).toEqual([
    'rollout-c.jsonl',
  ])
})

it('skips a path that would land outside CODEX_HOME', () => {
  writeRolloutsBack(home, [{path: '../escaped.jsonl', base64: btoa('x')}])

  expect(fs.existsSync(path.join(home, '..', 'escaped.jsonl'))).toBe(false)
  expect(fs.readdirSync(home)).toEqual([])
})
