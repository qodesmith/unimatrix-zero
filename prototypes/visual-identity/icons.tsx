// PROTOTYPE: rough app icon sketches, one per direction, drawn on the macOS 1024 grid (824 tile, 100 margin). Every
// one is a Tree: a root splitting into two Branches. Throw away.

const TILE =
  'M100 300C100 160 160 100 300 100H724C864 100 924 160 924 300V724C924 864 864 924 724 924H300C160 924 100 864 100 724Z'

function Warm() {
  return (
    <>
      <defs>
        <linearGradient id="w-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf6ef" />
          <stop offset="1" stopColor="#efe4d6" />
        </linearGradient>
      </defs>
      <path d={TILE} fill="url(#w-bg)" />
      <g stroke="#c2562f" strokeWidth="34" strokeLinecap="round" fill="none">
        <path d="M512 400V500C512 560 470 580 380 600" />
        <path d="M512 500C512 560 554 580 644 600" />
      </g>
      <rect x="362" y="250" width="300" height="160" rx="70" fill="#c2562f" />
      <rect
        x="236"
        y="590"
        width="260"
        height="150"
        rx="66"
        fill="#fffdfa"
        stroke="#c2562f"
        strokeWidth="26"
      />
      <rect
        x="528"
        y="590"
        width="260"
        height="150"
        rx="66"
        fill="#f3e7dc"
        stroke="#c2562f"
        strokeWidth="26"
      />
    </>
  )
}

function Cool() {
  return (
    <>
      <defs>
        <linearGradient id="c-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c1c1f" />
          <stop offset="1" stopColor="#09090b" />
        </linearGradient>
      </defs>
      <path d={TILE} fill="url(#c-bg)" />
      <path d={TILE} fill="none" stroke="#3f3f46" strokeWidth="4" />
      <g stroke="#fafafa" strokeWidth="22" fill="none" strokeLinejoin="round">
        <path d="M512 290V520L360 680" />
        <path d="M512 520L664 680" stroke="#7c84e8" />
      </g>
      <rect x="474" y="252" width="76" height="76" fill="#fafafa" />
      <rect
        x="474"
        y="482"
        width="76"
        height="76"
        fill="#09090b"
        stroke="#fafafa"
        strokeWidth="18"
      />
      <rect x="322" y="642" width="76" height="76" fill="#fafafa" />
      <rect x="626" y="642" width="76" height="76" fill="#7c84e8" />
    </>
  )
}

function Playful() {
  return (
    <>
      <defs>
        <linearGradient id="p-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6f86" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
      </defs>
      <path d={TILE} fill="url(#p-bg)" />
      <g stroke="#fff" strokeWidth="40" strokeLinecap="round" fill="none">
        <path d="M512 420C512 520 400 520 370 610" />
        <path d="M512 420C512 520 624 520 654 610" />
      </g>
      <circle cx="512" cy="330" r="118" fill="#ffe066" />
      <path d="M470 432L450 492L520 444Z" fill="#ffe066" />
      <circle cx="476" cy="318" r="16" fill="#22134d" />
      <circle cx="548" cy="318" r="16" fill="#22134d" />
      <path
        d="M470 362Q512 398 554 362"
        stroke="#22134d"
        strokeWidth="14"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="362" cy="680" r="96" fill="#fff" />
      <circle cx="662" cy="680" r="96" fill="#7ef0c8" />
    </>
  )
}

function Borg() {
  const grid = []
  for (let i = 1; i < 8; i++) {
    const p = 100 + i * 103
    grid.push(
      <path key={`h${i}`} d={`M100 ${p}H924`} />,
      <path key={`v${i}`} d={`M${p} 100V924`} />
    )
  }
  return (
    <>
      <defs>
        <filter id="b-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="14" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="b-clip">
          <path d={TILE} />
        </clipPath>
      </defs>
      <path d={TILE} fill="#020604" />
      <g clipPath="url(#b-clip)" stroke="#0e2a15" strokeWidth="4">
        {grid}
      </g>
      <g
        filter="url(#b-glow)"
        fill="none"
        stroke="#39ff6a"
        strokeWidth="18"
        strokeLinejoin="miter"
      >
        <path d="M512 230L740 362V626L512 758L284 626V362Z" />
        <path d="M284 362L512 494L740 362M512 494V758" opacity=".55" />
        <circle cx="512" cy="494" r="34" fill="#39ff6a" />
      </g>
    </>
  )
}

export const ICONS: Record<string, () => React.JSX.Element> = {
  A: Warm,
  B: Cool,
  C: Playful,
  D: Borg,
}

export function AppIcon({k, size}: {k: string; size: number}) {
  const Art = ICONS[k]!
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className="shrink-0"
    >
      <Art />
    </svg>
  )
}
