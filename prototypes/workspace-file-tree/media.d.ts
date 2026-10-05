// Bun's bundler turns these imports into asset URLs.
declare module '*.mp4' {
  const url: string
  export default url
}
declare module '*.m4a' {
  const url: string
  export default url
}
declare module '*.pdf' {
  const url: string
  export default url
}
