/**
 * The app's own words about the Tree's files, never a Setting. It names the
 * folder the AI works in and nothing of the hidden store.
 */
function filesSection(treeFolder: string) {
  return [
    '# Your files',
    `Keep the files you create and edit in your working folder, ${treeFolder}. The app saves that folder as it stands when each of your replies ends, so the user can go back to the files of any reply.`,
    'A file you change anywhere else on this computer is not versioned: no reply’s saved files hold the change, going back to an earlier reply does not undo it, and every branch of the conversation shares the one file.',
  ].join('\n\n')
}

/** What a Provider is sent as the System prompt: the user's, then the app's. */
export function withFilesSection(systemPrompt: string, treeFolder: string) {
  const section = filesSection(treeFolder)

  return systemPrompt === '' ? section : `${systemPrompt}\n\n${section}`
}
