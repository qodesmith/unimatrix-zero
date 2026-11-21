import {bridge} from '#modules/bridge/main'
import {useEffect} from 'react'
import {toast} from 'sonner'

export function SnapshotsWaiting() {
  useEffect(
    () =>
      bridge().subscribe(event => {
        if (event.type !== 'SNAPSHOTS_WAITING') return

        toast('File history starts once a download finishes', {
          description:
            'Unimatrix Zero is still getting what it needs to keep your files as they stood at each Reply.',
        })
      }),
    []
  )

  return null
}
