# `typescript/promise-function-async`

## React Components

In React 19, `React.ReactNode` includes `Promise<AwaitedReactNode>`, so a `useMemo`/callback returning `children` (or any `ReactNode`) is inferred as a promise-union and trips this rule. Fix it with an explicit return-type annotation (e.g. `useMemo((): React.ReactNode => …)`) — do NOT add the `async` keyword, which wraps the value in a real Promise and silently breaks the component.
