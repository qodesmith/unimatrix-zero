import type {MenuItemConstructorOptions} from 'electron'

import {expect, it} from 'vitest'

import {menuTemplate} from './menu'

const COMMAND =
  /^(?:cmd|command|ctrl|control|cmdorctrl|commandorcontrol|meta|super)$/iu

const FONT_SIZE_KEY = /^(?:plus|=|-|_|0|numadd|numsub|num0)$/iu

function everyItem(
  items: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  return items.flatMap(item => [
    item,
    ...(Array.isArray(item.submenu) ? everyItem(item.submenu) : []),
  ])
}

function takesFontSizeKey(accelerator: string) {
  const parts = accelerator.split('+')

  return (
    parts.slice(0, -1).some(part => COMMAND.test(part)) &&
    FONT_SIZE_KEY.test(parts.at(-1) ?? '')
  )
}

it.each(['darwin', 'win32', 'linux'] as const)(
  'offers no way to zoom the window on %s, leaving its keys to the font size',
  platform => {
    const items = everyItem(menuTemplate(platform))

    const zoomRoles = items.flatMap(({role}) =>
      role !== undefined && /zoom|viewMenu/iu.test(role) ? [role] : []
    )

    const zoomKeys = items.flatMap(({accelerator}) =>
      accelerator !== undefined && takesFontSizeKey(accelerator)
        ? [accelerator]
        : []
    )

    expect(zoomRoles).toEqual([])
    expect(zoomKeys).toEqual([])
  }
)
