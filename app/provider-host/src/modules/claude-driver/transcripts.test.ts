import type {SessionEntry} from '@uz/contract/host'

import {fakeStore} from '#modules/test-store/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {writeTranscriptBack} from './transcripts'

const PROJECT_KEY = '-tmp-uz-claude-config'
const SESSION_ID = 'af3affab-d77c-43f2-9ed8-a9e32acdfc14'

const cleanUps: (() => void)[] = []

afterEach(() => {
  for (const cleanUp of cleanUps.splice(0)) cleanUp()
})

function configFolder() {
  const made = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uz-claude-config-'))
  )

  cleanUps.push(() => fs.rmSync(made, {recursive: true, force: true}))

  return made
}

function readEntries(file: string): unknown[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

/** As the SDK's store mirror keeps a Subagent's transcript under its subpath. */
function subagent(agentId: string): SessionEntry[] {
  return [
    {type: 'user', uuid: `${agentId}-1`, isSidechain: true, agentId},
    {type: 'assistant', uuid: `${agentId}-2`, isSidechain: true, agentId},
  ]
}

it('writes each Subagent’s transcript and metadata back beside the session', async () => {
  const configDir = configFolder()
  const store = fakeStore()
  const session = {projectKey: PROJECT_KEY, sessionId: SESSION_ID}
  const own: SessionEntry[] = [{type: 'user', uuid: 'main-1'}]

  await store.client.append(session, own)
  await store.client.append({...session, subpath: 'subagents/agent-a1'}, [
    ...subagent('a1'),
    {type: 'agent_metadata', agentType: 'Explore', toolUseId: 'toolu_old'},
    {type: 'agent_metadata', agentType: 'Explore', toolUseId: 'toolu_1'},
  ])
  await store.client.append(
    {...session, subpath: 'subagents/agent-a2'},
    subagent('a2')
  )

  expect(await writeTranscriptBack(store.client, {configDir, ...session})).toBe(
    true
  )

  const folder = path.join(configDir, 'projects', PROJECT_KEY, SESSION_ID)
  const subagents = path.join(folder, 'subagents')

  expect(readEntries(`${folder}.jsonl`)).toEqual(own)
  expect(readEntries(path.join(subagents, 'agent-a1.jsonl'))).toEqual(
    subagent('a1')
  )
  expect(
    JSON.parse(
      fs.readFileSync(path.join(subagents, 'agent-a1.meta.json'), 'utf8')
    )
  ).toEqual({agentType: 'Explore', toolUseId: 'toolu_1'})
  expect(readEntries(path.join(subagents, 'agent-a2.jsonl'))).toEqual(
    subagent('a2')
  )
  expect(fs.existsSync(path.join(subagents, 'agent-a2.meta.json'))).toBe(false)
})

it('skips a Subagent whose subpath would land outside the session’s folder', async () => {
  const configDir = configFolder()
  const store = fakeStore()
  const session = {projectKey: PROJECT_KEY, sessionId: SESSION_ID}

  await store.client.append(session, [{type: 'user', uuid: 'main-1'}])
  await store.client.append({...session, subpath: '../../escaped'}, [
    ...subagent('a1'),
    {type: 'agent_metadata', agentType: 'Explore', toolUseId: 'toolu_1'},
  ])

  expect(await writeTranscriptBack(store.client, {configDir, ...session})).toBe(
    true
  )

  expect(fs.readdirSync(path.join(configDir, 'projects'))).toEqual([
    PROJECT_KEY,
  ])
  expect(fs.readdirSync(path.join(configDir, 'projects', PROJECT_KEY))).toEqual(
    [`${SESSION_ID}.jsonl`]
  )
})
