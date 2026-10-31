import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#shadcn/ui/alert-dialog'
import {Sheet, SheetContent, SheetTrigger} from '#shadcn/ui/sheet'
import {createElement} from 'react'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {dialogOpen} from './dialog-open'

it('sees a Sheet only while it is open', async () => {
  await render(
    createElement(
      Sheet,
      null,
      createElement(SheetTrigger, null, 'Open'),
      createElement(SheetContent, {'aria-label': 'Settings'})
    )
  )
  expect(dialogOpen()).toBe(false)

  await page.getByRole('button', {name: 'Open'}).click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  expect(dialogOpen()).toBe(true)

  await page.getByRole('button', {name: 'Close'}).click()
  await expect.poll(() => dialogOpen()).toBe(false)
})

it('sees an alert dialog only while it is open', async () => {
  await render(
    createElement(
      AlertDialog,
      null,
      createElement(AlertDialogTrigger, null, 'Delete'),
      createElement(
        AlertDialogContent,
        null,
        createElement(AlertDialogTitle, null, 'Delete 2 Turns?'),
        createElement(AlertDialogCancel, null, 'Cancel')
      )
    )
  )
  expect(dialogOpen()).toBe(false)

  await page.getByRole('button', {name: 'Delete'}).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  expect(dialogOpen()).toBe(true)

  await page.getByRole('button', {name: 'Cancel'}).click()
  await expect.poll(() => dialogOpen()).toBe(false)
})
