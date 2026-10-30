import type {MenuItemConstructorOptions} from 'electron'

/** ⌘+ and ⌘− belong to the font size, so View has no zoom items. */
export function menuTemplate(
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{role: 'appMenu' as const}] : []),
    {role: 'fileMenu'},
    {role: 'editMenu'},
    {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'forceReload'},
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    },
    {role: 'windowMenu'},
  ]
}
