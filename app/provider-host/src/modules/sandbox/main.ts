import path from 'node:path'

/**
 * Where the vendor's Sandbox runs. Elsewhere commands run without it, and
 * the cards still come first (ADR 0018).
 */
export function hasSandbox(platform: NodeJS.Platform) {
  return platform === 'darwin'
}

/**
 * Writable, so an install stays inside the Sandbox: without them `bun add`
 * fails before it reaches the network (ADR 0018).
 */
export function packageCaches(home: string) {
  return [
    ['.bun', 'install', 'cache'],
    ['.npm'],
    ['Library', 'pnpm', 'store'],
    ['.yarn', 'berry'],
    ['.cargo', 'registry'],
    ['.cargo', 'git'],
    // The OS cache folder, which holds pip's, Yarn 1's and pnpm's too.
    ['Library', 'Caches'],
  ].map(parts => path.join(home, ...parts))
}

/** The user's credentials, which nothing the AI runs or reads may open. */
export function credentialFolders(home: string) {
  return [
    ['.ssh'],
    ['.aws'],
    ['.config', 'gh'],
    ['.kube'],
    ['.gnupg'],
    ['Library', 'Keychains'],
  ].map(parts => path.join(home, ...parts))
}
