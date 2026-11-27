import type {ApprovalItem, ReviewDecision} from '../live-approvals'
import type {ApprovalAction} from '@uz/contract/permissions'
import type {ApprovalAnswer} from '@uz/contract/turns'

import {Refusal, useCommand} from '#modules/bridge/main'
import {Badge, badgeVariants} from '#shadcn/ui/badge'
import {Button} from '#shadcn/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#shadcn/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#shadcn/ui/collapsible'
import {cn} from 'cn'
import {ChevronRightIcon} from 'lucide-react'
import {useState} from 'react'

import {useSubagentDescription} from '../use-live-reply'

/** Only an edit inside the Tree's files is versioned with the Branch. */
function landsOutsideTree(action: ApprovalAction) {
  return !(action.kind === 'edit' && action.inTreeFiles)
}

type CardItem = Extract<ApprovalItem, {kind: 'card'}>

type ReviewItem = Extract<ApprovalItem, {kind: 'review'}>

function fileName(path: string) {
  return path.split(/[/\\]/u).findLast(segment => segment !== '') ?? path
}

function listed(names: string[]) {
  if (names.length < 3) return names.join(' and ')

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** An edit inside the Tree's files names the file; one elsewhere, its path. */
function whatItDoes(action: ApprovalAction) {
  switch (action.kind) {
    case 'edit':
      return `edit ${listed(action.inTreeFiles ? action.paths.map(fileName) : action.paths)}`
    case 'command':
      return action.outsideSandbox
        ? 'run this command on your whole computer'
        : 'run this command'
    case 'host':
      return `connect to ${action.host}`
    case 'mcp-tool':
      return `use ${action.tool} from ${action.server}`
    case 'tool':
      return `use ${action.name}`
    default:
      throw new Error('Unknown action.')
  }
}

function CommandText({action}: {action: ApprovalAction}) {
  if (action.kind !== 'command') return null

  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs whitespace-pre-wrap">
      {action.command}
    </pre>
  )
}

function whatItCouldReach(action: ApprovalAction) {
  if (action.kind === 'host' && action.fromCommand) {
    return `A command wants this connection. With it, the command could send your files to ${action.host} and download from there.`
  }

  if (action.kind !== 'command' || !action.outsideSandbox) return null

  return action.credentialsDenied
    ? 'Outside the Sandbox, it could read and change your files and reach the internet.'
    : 'Outside the Sandbox, it could read and change any of your files, use your saved logins and reach the internet.'
}

function WhatItReaches({action}: {action: ApprovalAction}) {
  const reach = whatItCouldReach(action)

  return reach === null ? null : (
    <p className="text-xs text-muted-foreground">{reach}</p>
  )
}

const ANSWERS: {answer: ApprovalAnswer; label: string}[] = [
  {answer: 'allow-once', label: 'Allow once'},
  {answer: 'always-allow', label: 'Always allow in this Tree'},
  {answer: 'deny', label: 'Deny'},
]

const BUTTON_VARIANT = {
  'allow-once': 'default',
  'always-allow': 'outline',
  deny: 'destructive',
} as const

function AskingCard({
  treeId,
  replyId,
  card,
}: {
  treeId: string
  replyId: string
  card: CardItem
}) {
  const {action, subagentId} = card
  const subagent = useSubagentDescription(replyId, subagentId)
  const command = useCommand()
  // Stays held once main takes the answer, until APPROVAL_RESOLVED replaces the card.
  const [answering, setAnswering] = useState(false)

  async function answer(chosen: ApprovalAnswer) {
    setAnswering(true)

    const taken = await command.run({
      type: 'reply.answer-approval',
      treeId,
      replyId,
      approvalId: card.id,
      answer: chosen,
    })

    if (!taken) setAnswering(false)
  }

  return (
    <Card
      size="sm"
      role="group"
      aria-label="Approval card"
      // Inset: the Reply's scroll box clips a ring drawn outside the card.
      className="ring-0 inset-ring inset-ring-primary/50"
    >
      <CardHeader>
        {subagentId !== null && (
          <CardDescription className="text-xs">
            {subagent === null
              ? 'Asked by a Subagent'
              : `Asked by a Subagent: ${subagent}`}
          </CardDescription>
        )}
        <CardTitle>The AI wants to {whatItDoes(action)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <CommandText action={action} />
        <WhatItReaches action={action} />
        {landsOutsideTree(action) && (
          <p className="text-xs text-muted-foreground">
            This happens outside the conversation, so other Branches will see it
            too.
          </p>
        )}
        <Refusal error={command.error} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {ANSWERS.map(({answer: one, label}) => (
          <Button
            key={one}
            size="sm"
            variant={BUTTON_VARIANT[one]}
            disabled={answering}
            onClick={() => void answer(one)}
          >
            {label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  )
}

const ALLOWED = 'border-transparent bg-success/10 text-success'

function AnsweredChip({card}: {card: CardItem}) {
  const allowed = card.answer !== 'deny'

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge
        variant={allowed ? 'outline' : 'destructive'}
        className={cn(allowed && ALLOWED)}
      >
        {allowed ? '✓ allowed' : '✕ denied'}
      </Badge>
      <span className="truncate">{whatItDoes(card.action)}</span>
    </div>
  )
}

function shownReason({decision, reason}: ReviewDecision) {
  return decision === 'unanswered' ? "Reviewer didn't answer" : reason
}

function ReviewChip({
  action,
  decision,
}: {
  action: ApprovalAction
  decision: ReviewDecision
}) {
  const approved = decision.decision === 'approved'
  const reason = shownReason(decision)

  return (
    <Collapsible className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <CollapsibleTrigger
          className={cn(
            badgeVariants({variant: approved ? 'outline' : 'destructive'}),
            'group/review-trigger cursor-pointer',
            approved && ALLOWED
          )}
        >
          <ChevronRightIcon className="transition-transform group-aria-expanded/review-trigger:rotate-90" />
          {approved ? '✓ approved by reviewer' : '✕ declined by reviewer'}
        </CollapsibleTrigger>
        {!approved && reason !== null && <span>{reason}</span>}
      </div>
      <CollapsibleContent keepMounted className="flex flex-col gap-1 pl-2">
        <p>The AI wanted to {whatItDoes(action)}</p>
        <CommandText action={action} />
        {approved && reason !== null && <p>{reason}</p>}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ReviewView({review}: {review: ReviewItem}) {
  if (review.decision === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Reviewing…</span>
        <span className="truncate">{whatItDoes(review.action)}</span>
      </p>
    )
  }

  return <ReviewChip action={review.action} decision={review.decision} />
}

/** An approval card, its chip once answered, or the Reviewer's decision. */
export function ApprovalView({
  treeId,
  replyId,
  item,
}: {
  treeId: string
  replyId: string
  item: ApprovalItem
}) {
  if (item.kind === 'review') return <ReviewView review={item} />

  return item.answer === null ? (
    <AskingCard treeId={treeId} replyId={replyId} card={item} />
  ) : (
    <AnsweredChip card={item} />
  )
}
