import type {MenuItemConstructorOptions} from 'electron'

import {expect, it} from 'vitest'

import {menuTemplate} from './menu'

function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap(item => [
    ...(item.role === undefined ? [] : [item.role]),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ])
}

it.each(['darwin', 'win32', 'linux'] as const)(
  'offers no way to zoom the window on %s',
  platform => {
    const zooms = roles(menuTemplate(platform)).filter(role =>
      /zoom|viewMenu/i.test(role)
    )

    expect(zooms).toEqual([])
  }
)
