import {Kbd, KbdGroup} from '#shadcn/ui/kbd'
import {SidebarTrigger} from '#shadcn/ui/sidebar'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'

/**
 * Opens and closes the app sidebar; ⌘B is stock `SidebarProvider`'s own
 * listener.
 */
export function SidebarToggle() {
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarTrigger />} />
      <TooltipContent>
        Toggle sidebar
        <KbdGroup>
          <Kbd>⌘/Ctrl</Kbd>
          <Kbd>B</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  )
}
