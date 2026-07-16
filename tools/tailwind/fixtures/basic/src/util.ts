declare function cva(base: string, config: unknown): unknown
declare function twMerge(...classes: string[]): string

export const styles = cva('mt-[4px]', {
  variants: {size: {sm: 'gap-[0.5rem]'}},
})

export const merged = twMerge('leading-[1.5]', 'z-[10]')

// Outside any className/cn span — never extracted:
export const notExtracted = 'p-[8px] w-[32px]'
