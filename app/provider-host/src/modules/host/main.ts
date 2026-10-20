export function startHost(provider: 'claude' | 'chatgpt') {
  process.parentPort.postMessage({type: 'HOST_STARTED', provider})
}
