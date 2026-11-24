/** Main's refusal of a command, shown where the user asked for it. */
export function Refusal({error}: {error: string | null}) {
  if (error === null) return null

  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
}
