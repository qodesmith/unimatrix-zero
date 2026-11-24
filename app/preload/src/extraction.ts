import {ipcRenderer} from 'electron'

import {EXTRACTION_PORT_MESSAGE} from './extraction-port'

// The extraction window's page gets its job's port and nothing else: no
// bridge, so the page reaches main only through the port (ADR 0014).
ipcRenderer.once(EXTRACTION_PORT_MESSAGE, event => {
  globalThis.postMessage(
    EXTRACTION_PORT_MESSAGE,
    globalThis.location.origin,
    event.ports
  )
})
