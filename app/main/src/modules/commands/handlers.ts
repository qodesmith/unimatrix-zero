import type {Command, CommandResult, CommandType} from '@uz/contract/commands'

export type HandlerDeps = {
  now: () => Date
}

type Handler<T extends CommandType> = (
  command: Extract<Command, {type: T}>,
  deps: HandlerDeps
) => Promise<CommandResult<T>> | CommandResult<T>

export const handlers: {[T in CommandType]: Handler<T>} = {
  'app.ping': ({nonce}, {now}) => ({nonce, repliedAt: now().toISOString()}),
}
