/** Fixed app text, never a Setting. It must not name the hidden store. */
function filesSection(treeFolder: string) {
  return [
    '# Your files',
    `Keep the files you create and edit in your working folder, ${treeFolder}. The app saves that folder as it stands when each of your replies ends, so the user can go back to the files of any reply.`,
    'A file you change anywhere else on this computer is not versioned: no reply’s saved files hold the change, going back to an earlier reply does not undo it, and every branch of the conversation shares the one file.',
  ].join('\n\n')
}

/** A Provider dependency on the Model (`plain-words-for-the-user`). */
const USER_SECTION = [
  '# The user',
  'The user may not be a developer: they may have no terminal and may not know developer terms. Do what you can yourself. When you can’t, explain in plain words and give a step they can take without a terminal.',
  'When git asks who is saving a commit, don’t use the user’s real name or email unless they say so: anyone with a copy of the history can read them.',
  'Don’t promise to do something yourself once the user signs in elsewhere, such as in GitHub Desktop: the git you run may not see that sign-in.',
].join('\n\n')

export function withAppSections(systemPrompt: string, treeFolder: string) {
  const sections = `${filesSection(treeFolder)}\n\n${USER_SECTION}`

  return systemPrompt === '' ? sections : `${systemPrompt}\n\n${sections}`
}
