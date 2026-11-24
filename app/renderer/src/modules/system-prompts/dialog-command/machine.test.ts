import type {DialogCommandEvent, DialogCommandState} from './machine'

import {expect, it} from 'vitest'

import {dialogCommandTransition, initialDialogCommand} from './machine'

const asking: DialogCommandState = {status: 'asking'}
const running: DialogCommandState = {status: 'running'}
const refused: DialogCommandState = {status: 'refused', error: 'Gone'}

const asked: DialogCommandEvent = {type: 'asked'}
const canceled: DialogCommandEvent = {type: 'canceled'}
const confirmed: DialogCommandEvent = {type: 'confirmed'}
const succeeded: DialogCommandEvent = {type: 'succeeded'}
const refusal: DialogCommandEvent = {type: 'refused', error: 'Gone'}

it('opens on asked, and ignores every other event while closed', () => {
  expect(dialogCommandTransition(initialDialogCommand, asked)).toEqual(asking)

  for (const event of [canceled, confirmed, succeeded, refusal]) {
    expect(dialogCommandTransition(initialDialogCommand, event)).toBe(
      initialDialogCommand
    )
  }
})

it('closes on canceled and runs on confirmed while asking, ignoring the rest', () => {
  expect(dialogCommandTransition(asking, canceled)).toEqual(
    initialDialogCommand
  )
  expect(dialogCommandTransition(asking, confirmed)).toEqual(running)

  for (const event of [asked, succeeded, refusal]) {
    expect(dialogCommandTransition(asking, event)).toBe(asking)
  }
})

it('closes once main has done it, or says why main refused, and takes nothing else while running', () => {
  expect(dialogCommandTransition(running, succeeded)).toEqual(
    initialDialogCommand
  )
  expect(dialogCommandTransition(running, refusal)).toEqual(refused)

  for (const event of [asked, canceled, confirmed]) {
    expect(dialogCommandTransition(running, event)).toBe(running)
  }
})

it('runs again or closes after a refusal, ignoring the rest', () => {
  expect(dialogCommandTransition(refused, confirmed)).toEqual(running)
  expect(dialogCommandTransition(refused, canceled)).toEqual(
    initialDialogCommand
  )

  for (const event of [asked, succeeded, refusal]) {
    expect(dialogCommandTransition(refused, event)).toBe(refused)
  }
})
