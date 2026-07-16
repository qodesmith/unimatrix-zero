import {cn} from './cn'

export function Button({active}: {active: boolean}) {
  return (
    <button className={cn('flex w-[16px]', active && 'p-[8px]')}>
      <span className="hover:w-[16px]">go</span>
    </button>
  )
}
