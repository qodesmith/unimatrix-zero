import {bridge} from '#modules/bridge/main'
import {Toaster} from '#shadcn/ui/sonner'
import {useEffect} from 'react'
import {toast} from 'sonner'

/** Main says so once per launch, the first time a Snapshot waits. */
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

  return <Toaster />
}
