export function Refusal({error}: {error: string | null}) {
  if (error === null) return null

  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
}
