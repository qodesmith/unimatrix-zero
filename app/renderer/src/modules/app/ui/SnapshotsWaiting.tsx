import {bridge} from '#modules/bridge/main'
import {useEffect} from 'react'
import {toast} from 'sonner'

/** One toast at a time: a failure takes the place of "still downloading". */
const DOWNLOAD_TOAST = 'snapshots-download'

export function SnapshotsWaiting() {
  useEffect(
    () =>
      bridge().subscribe(event => {
        if (event.type === 'SNAPSHOTS_WAITING') {
          toast('File history starts once a download finishes', {
            id: DOWNLOAD_TOAST,
            description:
              'Unimatrix Zero is still getting what it needs to keep your files as they stood at each Reply.',
          })
        }

        if (event.type === 'SNAPSHOTS_DOWNLOAD_FAILED') {
          toast('File history couldn’t download', {
            id: DOWNLOAD_TOAST,
            description:
              'Unimatrix Zero can’t keep your files as they stood at each Reply until it does. Check your internet connection, then try again.',
            duration: Infinity,
            action: {
              label: 'Try again',
              onClick: () => {
                void bridge().send({type: 'snapshots.download-again'})
              },
            },
          })
        }

        if (event.type === 'SNAPSHOTS_NEED_NEWER_LINUX') {
          toast('File history can’t work on this computer', {
            description:
              'It needs a newer version of Linux, such as Ubuntu 22.04 or later.',
          })
        }
      }),
    []
  )

  return null
}
