import {Input} from '#shadcn/ui/input'
import {InputGroupButton} from '#shadcn/ui/input-group'
import {PaperclipIcon} from 'lucide-react'
import {useRef} from 'react'

/** Never disabled for the picked Model: a file it can't take is converted. */
export function AttachButton({onPicked}: {onPicked: (files: File[]) => void}) {
  const chooser = useRef<HTMLInputElement>(null)

  return (
    <>
      <Input
        ref={chooser}
        type="file"
        multiple
        hidden
        aria-label="Files to attach"
        onChange={event => {
          const files = [...(event.target.files ?? [])]

          event.target.value = ''

          if (files.length > 0) onPicked(files)
        }}
      />
      <InputGroupButton
        size="icon-xs"
        aria-label="Attach files"
        onClick={() => chooser.current?.click()}
      >
        <PaperclipIcon />
      </InputGroupButton>
    </>
  )
}
