const palette =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black'

const utilities =
  'bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|accent|caret|divide|placeholder|shadow|inset-ring|inset-shadow'

/** A Tailwind palette class (`bg-zinc-900`) instead of a token class. */
export const paletteClass = new RegExp(
  `(?:^|\\s|:)(?:${utilities})-(?:${palette})(?:-\\d{2,3})?(?:/\\d+)?(?=\\s|$)`
)

/** A color literal: hex, or an rgb/hsl/oklch/oklab function. */
export const colorLiteral =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/
