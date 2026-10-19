/**
 * A Provider host runs as its own utility process, started by main once its
 * Provider is connected. The drivers arrive with their own tickets; for now the
 * host only announces itself so the build shape is in place.
 */
export function startHost(provider: 'claude' | 'chatgpt') {
  process.parentPort.postMessage({type: 'HOST_STARTED', provider})
}
