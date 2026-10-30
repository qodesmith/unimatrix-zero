import type {ReactNode} from 'react'

import {cn} from '#modules/shadcn/main'
import {useState} from 'react'

import {AppearanceSection, ChatSection} from './Sections'

const SECTIONS = [
  'Appearance',
  'Chat',
  'System prompts',
  'Tools',
  'Connections',
  'Storage',
  'Archive & restore',
  'Updates & About',
] as const

type Section = (typeof SECTIONS)[number]

interface SettingsPageProps {
  /** The Provider cards, which belong to the connections module. */
  connections: ReactNode
}

/** Every global Setting, one section at a time. */
export function SettingsPage({connections}: SettingsPageProps) {
  const [openSection, setOpenSection] = useState<Section>('Appearance')

  const content: Partial<Record<Section, ReactNode>> = {
    Appearance: <AppearanceSection />,
    Chat: <ChatSection />,
    Connections: connections,
  }

  return (
    <div className="flex h-full bg-background">
      <nav
        aria-label="Settings sections"
        className="flex w-52 shrink-0 flex-col gap-1 border-r border-border p-4"
      >
        <h1 className="mb-3 px-3 text-lg font-semibold">Settings</h1>
        {SECTIONS.map(section => (
          <button
            key={section}
            type="button"
            aria-current={section === openSection ? 'page' : undefined}
            disabled={content[section] === undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
              section === openSection && 'bg-accent font-medium'
            )}
            onClick={() => setOpenSection(section)}
          >
            {section}
          </button>
        ))}
      </nav>
      <section
        aria-label={openSection}
        className="min-w-0 flex-1 overflow-y-auto p-8"
      >
        <div className="flex max-w-2xl flex-col gap-8">
          <h2 className="text-2xl font-semibold">{openSection}</h2>
          {content[openSection]}
        </div>
      </section>
    </div>
  )
}
