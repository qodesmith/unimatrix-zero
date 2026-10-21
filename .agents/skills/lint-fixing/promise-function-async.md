# `typescript/promise-function-async`

## React components

In React 19, `React.ReactNode` includes `Promise<AwaitedReactNode>`, so a `useMemo` or a callback that returns `children`, or any other `ReactNode`, is inferred as a promise union and trips this rule.
Fix it with an explicit return-type annotation, for example `useMemo((): React.ReactNode => ...)`.
Keep the `async` keyword off it: `async` wraps the value in a real Promise, which breaks the component silently.
