import type {FirstLaunchEvent} from './machine'

interface StartInput {
  createTree: () => Promise<void>
  send: (event: FirstLaunchEvent) => void
}

/** A refused Tree still leaves the Connections screen: the sidebar shows why. */
export async function startChatting({createTree, send}: StartInput) {
  await createTree()
  send({type: 'started'})
}
