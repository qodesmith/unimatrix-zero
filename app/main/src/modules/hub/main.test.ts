import type {AppEvent} from '@uz/contract/events'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it} from 'vitest'

import {createHub} from './main'

const tree = {
  id: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  title: null,
  createdAt: '2026-10-19T12:00:00.000Z',
}

function setUp() {
  return createHub(() => ({
    type: 'SNAPSHOT',
    app: {version: '1.0.0'},
    replies: [],
    providers: [],
    signIn: null,
    settings: DEFAULT_SETTINGS,
    layout: DEFAULT_LAYOUT,
  }))
}

function recorder() {
  const received: AppEvent[] = []

  return {received, send: (event: AppEvent) => received.push(event)}
}

it('sends a SNAPSHOT on connect, then only what is published after it', () => {
  const hub = setUp()
  const window = recorder()

  hub.publish({type: 'TREE_CREATED', tree})
  hub.connect(1, window.send)
  hub.publish({type: 'TREE_RENAMED', tree: {...tree, title: 'Later'}})

  expect(window.received.map(event => event.type)).toEqual([
    'SNAPSHOT',
    'TREE_RENAMED',
  ])
})

it('replaces a reloaded window’s connection rather than doubling its events', () => {
  const hub = setUp()
  const beforeReload = recorder()
  const afterReload = recorder()

  hub.connect(1, beforeReload.send)
  hub.connect(1, afterReload.send)
  hub.publish({type: 'TREE_CREATED', tree})

  expect(beforeReload.received.map(event => event.type)).toEqual(['SNAPSHOT'])
  expect(afterReload.received.map(event => event.type)).toEqual([
    'SNAPSHOT',
    'TREE_CREATED',
  ])
})

it('stops sending to a window once it disconnects', () => {
  const hub = setUp()
  const window = recorder()

  hub.connect(1, window.send)
  hub.disconnect(1)
  hub.publish({type: 'TREE_CREATED', tree})

  expect(window.received.map(event => event.type)).toEqual(['SNAPSHOT'])
})
