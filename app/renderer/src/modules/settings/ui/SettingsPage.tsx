import type {ReactNode} from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '#modules/shadcn/main'
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
    <SidebarProvider className="h-full min-h-0 bg-background">
      <Sidebar
        collapsible="none"
        className="w-52 border-r border-sidebar-border"
      >
        <SidebarHeader>
          <h1 className="px-2 pt-2 text-lg font-semibold">Settings</h1>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Settings sections">
                <SidebarMenu>
                  {SECTIONS.map(section => (
                    <SidebarMenuItem key={section}>
                      <SidebarMenuButton
                        isActive={section === openSection}
                        aria-current={
                          section === openSection ? 'page' : undefined
                        }
                        disabled={content[section] === undefined}
                        onClick={() => setOpenSection(section)}
                      >
                        <span>{section}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <section
        aria-label={openSection}
        className="h-full min-w-0 flex-1 overflow-y-auto p-8"
      >
        <div className="flex max-w-2xl flex-col gap-8">
          <h2 className="text-2xl font-semibold">{openSection}</h2>
          {content[openSection]}
        </div>
      </section>
    </SidebarProvider>
  )
}
