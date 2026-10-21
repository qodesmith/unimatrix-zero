import type {Command, CommandResult, CommandType} from '@uz/contract/commands'

export interface HandlerDeps {
  now: () => Date
}

type Handler<T extends CommandType> = (
  command: Extract<Command, {type: T}>,
  deps: HandlerDeps
) => Promise<CommandResult<T>> | CommandResult<T>

type Handlers = {[T in CommandType]: Handler<T>}

export const handlers: Handlers = {
  'app.ping': ({nonce}, {now}) => ({nonce, receivedAt: now().toISOString()}),
}
