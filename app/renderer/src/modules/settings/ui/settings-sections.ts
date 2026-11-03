export const SECTIONS = [
  'Appearance',
  'Chat',
  'System prompts',
  'Tools',
  'Connections',
  'Storage',
  'Archive & restore',
  'Updates & About',
] as const

export type Section = (typeof SECTIONS)[number]
