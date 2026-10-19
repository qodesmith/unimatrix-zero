import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {IpcMain, IpcMainInvokeEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {CommandSchema} from '@uz/contract/commands'

import {handlers, type HandlerDeps} from './handlers'

export type Sender = {
  isTopLevelAppFrame: boolean
}

const defaultDeps: HandlerDeps = {
  now: () => new Date(),
}

export async function dispatchCommand(
  raw: unknown,
  sender: Sender,
  deps: HandlerDeps = defaultDeps
): Promise<CommandOutcome<CommandType>> {
  if (!sender.isTopLevelAppFrame) {
    return {
      ok: false,
      error: {
        code: 'untrusted-sender',
        message: 'Commands are accepted from the app window only.',
      },
    }
  }
  const parsed = CommandSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: {code: 'invalid-command', message: parsed.error.message},
    }
  }
  try {
    return {ok: true, value: await runHandler(parsed.data, deps)}
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'handler-failed',
        message: cause instanceof Error ? cause.message : String(cause),
      },
    }
  }
}

function runHandler<T extends CommandType>(
  command: Extract<Command, {type: T}>,
  deps: HandlerDeps
) {
  return handlers[command.type](command, deps)
}

export function registerCommandChannel(
  ipcMain: IpcMain,
  senderOf: (event: IpcMainInvokeEvent) => Sender
) {
  ipcMain.handle(BRIDGE_CHANNELS.command, (event, raw: unknown) =>
    dispatchCommand(raw, senderOf(event))
  )
}
