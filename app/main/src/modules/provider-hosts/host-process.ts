import type {HostCommand} from '@uz/contract/host'

export interface HostProcess {
  post(command: HostCommand): void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the process boundary: HostMessageSchema parses it
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: () => void): void
  kill(): void
}
