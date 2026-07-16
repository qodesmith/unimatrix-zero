export function Card({extra}: {extra: string}) {
  return (
    <div className={`w-[16px] ${extra}`}>
      <div className="rounded-[4px] w-[16px]">x</div>
      <p className={'[display:flex]'}>y</p>
    </div>
  )
}
