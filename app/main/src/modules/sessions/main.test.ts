import type {SessionEntry} from '@uz/contract/host'

import {openDatabase} from '#modules/database/main'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createSessions} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const key = {projectKey: 'project', sessionId: 'session'}

let sessions: ReturnType<typeof createSessions>

beforeEach(() => {
  sessions = createSessions(openDatabase({file: ':memory:', migrationsFolder}))
})

function append(entries: SessionEntry[], subpath?: string) {
  sessions.handle('claude', {
    op: 'append',
    key: subpath ? {...key, subpath} : key,
    entries,
  })
}

it('gives back a session’s entries in the order they were appended', () => {
  append([{type: 'user', uuid: 'a', message: {content: 'Hi'}}])
  append([{type: 'title'}, {type: 'assistant', uuid: 'b', nested: [1, 2]}])

  expect(sessions.handle('claude', {op: 'load', key})).toEqual([
    {type: 'user', uuid: 'a', message: {content: 'Hi'}},
    {type: 'title'},
    {type: 'assistant', uuid: 'b', nested: [1, 2]},
  ])
})

it('keeps an entry appended twice once, and entries with no uuid every time', () => {
  append([{type: 'user', uuid: 'a'}, {type: 'mode'}])
  append([{type: 'user', uuid: 'a'}, {type: 'mode'}])

  expect(sessions.handle('claude', {op: 'load', key})).toEqual([
    {type: 'user', uuid: 'a'},
    {type: 'mode'},
    {type: 'mode'},
  ])
})

it('loads nothing for a session it never kept', () => {
  append([{type: 'user', uuid: 'a'}])

  expect(
    sessions.handle('claude', {
      op: 'load',
      key: {...key, sessionId: 'other'},
    })
  ).toBeNull()
  expect(sessions.handle('chatgpt', {op: 'load', key})).toBeNull()
})

it('keeps a Subagent’s transcript apart and lists it under the session', () => {
  append([{type: 'user', uuid: 'a'}])
  append([{type: 'user', uuid: 'a'}], 'subagents/agent-1')

  expect(
    sessions.handle('claude', {
      op: 'load',
      key: {...key, subpath: 'subagents/agent-1'},
    })
  ).toEqual([{type: 'user', uuid: 'a'}])
  expect(sessions.handle('claude', {op: 'list-subkeys', ...key})).toEqual([
    'subagents/agent-1',
  ])
})

function file(text: string) {
  return {
    path: 'tool-results/a.txt',
    base64: Buffer.from(text).toString('base64'),
  }
}

it('keeps the latest copy of each file beside a session', () => {
  sessions.handle('claude', {op: 'save-files', ...key, files: [file('one')]})
  sessions.handle('claude', {op: 'save-files', ...key, files: [file('two')]})

  expect(sessions.handle('claude', {op: 'load-files', ...key})).toEqual([
    file('two'),
  ])
})
