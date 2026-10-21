# Resolving `complexity` violations

`complexity` counts the branches of one function: each `if`, loop, `case`, `catch`, `&&`, `||`, `??` and `?:`.
It counts every function, a React component included.
The limit measures how many paths a reader holds at once, so the fix is fewer paths, not the same paths in more places.

## Keep the paths together when you shrink the function

Moving half the branches into `handleRest()` or `helperForX()` passes the rule and leaves the reader with the same paths, now across two functions that no module owns.
A fix removes paths or gives them a name that says why they exist.
Pick the fix from the shape of the branches, with the sections below.

## Replace a branch chain with a lookup table

A chain that maps a value to a value is data.

```ts
// Before: one path per status.
if (status === 'draft') return 'Draft'
if (status === 'sent') return 'Sent'
if (status === 'paid') return 'Paid'
return 'Unknown'

// After: one path.
const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
}
return STATUS_LABEL[status]
```

A `Record` keyed on the union also fails typecheck when the union gains a member, which the chain never did.

## Return early on each guard

A guard nested around the main path adds its branch to every path after it.
Return on the guard, and the main path reads flat below it.

```ts
function total(invoice: Invoice | undefined) {
  if (!invoice) return 0
  if (invoice.voided) return 0
  return invoice.lines.reduce((sum, line) => sum + line.amount, 0)
}
```

## Name a function for the business rule it holds

A group of conditions that together decide one thing is a rule of the domain.
Give it a function named for the rule, so the caller reads one decision.

```ts
/** A customer may reorder only a paid invoice that is less than a year old. */
function canReorder(invoice: Invoice, now: Date) {
  return invoice.status === 'paid' && ageInDays(invoice, now) < 365
}
```

The test for the name: a product owner would recognize it.
`checkConditions` and `processPart2` fail the test.

## Compose a component from parts

A component over the limit usually renders several states from one body.
Give each state a part that decides its own markup, and let the component place the parts.

```tsx
function InvoiceCard({invoice}: {invoice: Invoice}) {
  return (
    <Card>
      <InvoiceHeader invoice={invoice} />
      <InvoiceLines invoice={invoice} />
      <InvoiceActions invoice={invoice} />
    </Card>
  )
}
```

## Move the logic to the module that owns it

Branches about another feature's data belong to that feature.
When a function decides a rule of invoices from inside payments, put the rule in the invoices module's `main.ts` and call it.
README.md, section Modules, says how modules expose their interface; the `codebase-design` skill says how it grows.

```ts
// payments: one call in place of five branches about invoice state.
if (!isPayable(invoice)) return
```

## Disable the rule only with its reason

A function that is a flat table of cases by nature, such as a parser's dispatch, may stay over the limit.
Put the reason in the disable comment, so a reviewer can argue with it:

```ts
// oxlint-disable-next-line complexity -- one case per token kind of the grammar
function readToken(char: string) {
```
