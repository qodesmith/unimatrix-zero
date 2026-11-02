import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {DeleteTreeDialog} from './DeleteTreeDialog'

const LINKED_FOLDER = 'The linked folder stays where it is, untouched.'

async function renderDialog(linkedFolder?: boolean) {
  return render(
    <DeleteTreeDialog
      open
      linkedFolder={linkedFolder}
      onCancel={() => {}}
      onConfirm={() => {}}
    />
  )
}

it('says the linked folder stays when the Tree has one', async () => {
  await renderDialog(true)

  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete Tree?'}))
    .toHaveAccessibleDescription(
      `This Tree will be permanently deleted. This can’t be undone. ${LINKED_FOLDER}`
    )
})

it('says nothing of a folder when the Tree has none linked', async () => {
  await renderDialog()

  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete Tree?'}))
    .toBeVisible()
  expect(page.getByText(LINKED_FOLDER).query()).toBeNull()
})
