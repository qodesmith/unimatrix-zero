/**
 * The contract's `EXTRACTION_PORT_MESSAGE`, copied: importing the contract
 * would put a chunk the app's preload shares into this one, and a sandboxed
 * preload can't `require` a chunk.
 */
export const EXTRACTION_PORT_MESSAGE = 'uz:extraction-port'
