// PROTOTYPE: shared pieces for the Export, Archive and Summary entry points variants. Throw away.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  simCache,
  childrenOf,
  contextSize,
  formatTokens,
  pathTo,
  type Tree,
  type Turn,
} from '../canvas-mode-ux/tree'
import {useToast} from '../workspace-file-tree/common'
import {formatSize} from '../workspace-file-tree/workspace'

// The file extension waits for the app name.
export const EXT = '.uzarchive'

// ---------- prototype knobs ----------

export type Knobs = {
  freeBytes: number
  // Multiplies Tree token counts so split Summary runs can be seen.
  hugeTree: boolean
}
export const KnobsContext = createContext<{
  knobs: Knobs
  setKnobs: (k: Knobs) => void
}>({knobs: {freeBytes: 212e9, hugeTree: false}, setKnobs: () => {}})
export const useKnobs = () => useContext(KnobsContext)

// ---------- Tree facts ----------

export const turnsOf = (tree: Tree) => Object.values(tree)
export const leavesOf = (tree: Tree) =>
  turnsOf(tree).filter(
    t => t.kind === 'reply' && !childrenOf(tree, t.id).length
  )
export const treeTokens = (tree: Tree, huge: boolean) =>
  turnsOf(tree).reduce((s, t) => s + t.tokens, 0) * (huge ? 400 : 1)

// Fake but plausible: Turns are small, Provider session copies bigger, Workspace history depends on the Tree.
export function archiveSize(key: string) {
  const s = simCache.get(key)
  const n = s ? turnsOf(s.tree).length : 0
  const workspace = !s?.workspace
    ? 0
    : s.workspace.kind === 'linked'
      ? 412e6
      : 38e6
  return {turns: n * 3_000, sessions: n * 18_000, attachments: 2.4e6, workspace}
}
export const sum = (o: Record<string, number>) =>
  Object.values(o).reduce((a, b) => a + b, 0)

// Fit check from Disk usage and low disk space: size + 1 GB.
export const fits = (bytes: number, free: number) => bytes + 1e9 <= free

// ---------- Markdown ----------

const who = (t: Turn) => (t.kind === 'prompt' ? 'You' : (t.model ?? 'AI'))

export function threadMarkdown(tree: Tree, replyId: string, title: string) {
  const turns = pathTo(tree, replyId)
  return [
    `# ${title}`,
    '',
    ...turns.flatMap(t => [
      `## ${who(t)}`,
      '',
      t.text.trim() || '_(attachments only)_',
      '',
    ]),
  ].join('\n')
}

export function outlineMarkdown(tree: Tree, title: string) {
  const out = [`# ${title}`, '']
  const walk = (id: string | null, depth: number, label: string) => {
    for (const [i, t] of childrenOf(tree, id).entries()) {
      const forks =
        childrenOf(tree, t.parentId).length > 1 && t.kind === 'prompt'
      const here = forks ? `${label}${i + 1}.` : label
      if (forks)
        out.push(`${'#'.repeat(Math.min(depth + 2, 6))} Branch ${here}`, '')
      out.push(
        `**${who(t)}:** ${t.text.trim().split('\n')[0]!.slice(0, 160)}`,
        ''
      )
      walk(t.id, forks ? depth + 1 : depth, here)
    }
  }
  walk(null, 0, '')
  return out.join('\n')
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'thread'

// ---------- generic UI ----------

export function Modal({
  children,
  onClose,
  width = 520,
}: {
  children: ReactNode
  onClose: () => void
  width?: number
}) {
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        style={{width}}
        className="max-h-[88vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export type MenuItem =
  | {
      label: string
      onClick: () => void
      hint?: string
      danger?: boolean
      disabled?: boolean
    }
  | 'sep'

export function Menu({
  items,
  onClose,
  style,
  className = '',
}: {
  items: MenuItem[]
  onClose: () => void
  style?: React.CSSProperties
  className?: string
}) {
  useEffect(() => {
    const close = () => onClose()
    const t = setTimeout(() => window.addEventListener('click', close), 0)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div
      style={style}
      className={`nodrag z-[60] min-w-52 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-xl ${className}`}
      onClick={e => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="my-1 border-t border-zinc-100" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick()
            }}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-40 ${it.danger ? 'text-red-600' : 'text-zinc-800'}`}
          >
            <span className="flex-1">{it.label}</span>
            {it.hint && (
              <span className="text-[11px] text-zinc-400">{it.hint}</span>
            )}
          </button>
        )
      )}
    </div>
  )
}

export const Btn = ({
  children,
  onClick,
  primary,
  danger,
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  className?: string
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${danger ? 'bg-red-600 text-white hover:bg-red-700' : primary ? 'bg-zinc-900 text-white hover:bg-zinc-700' : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50'} ${className}`}
  >
    {children}
  </button>
)

function MarkdownPreview({text}: {text: string}) {
  return (
    <pre className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] whitespace-pre-wrap text-zinc-700">
      {text}
    </pre>
  )
}

// ---------- Export ----------

export type ExportTarget =
  | {kind: 'thread'; treeKey: string; replyId: string; title: string}
  | {kind: 'tree'; treeKey: string; title: string}

export function ExportBody({
  target,
  onDone,
}: {
  target: ExportTarget
  onDone: () => void
}) {
  const toast = useToast()
  const tree = simCache.get(target.treeKey)!.tree
  const [shape, setShape] = useState<'per-thread' | 'outline'>('outline')
  const threads = leavesOf(tree)
  const md =
    target.kind === 'thread'
      ? threadMarkdown(tree, target.replyId, target.title)
      : shape === 'outline'
        ? outlineMarkdown(tree, target.title)
        : threadMarkdown(tree, threads[0]!.id, `${target.title} · Thread 1`)
  const turns =
    target.kind === 'thread'
      ? pathTo(tree, target.replyId).length
      : turnsOf(tree).length
  return (
    <>
      <p className="text-sm text-zinc-600">
        {target.kind === 'thread'
          ? `${turns} Turns, from the first Prompt to this Reply, as one Markdown file.`
          : `${turns} Turns in ${threads.length} Threads.`}{' '}
        Readable anywhere. It can’t be restored into the app; use Archive for
        that.
      </p>
      {target.kind === 'tree' && (
        <div className="mt-3 flex flex-col gap-1.5 text-sm">
          {(
            [
              [
                'outline',
                'One outline file',
                'The whole Tree in one file, Branches as nested headings',
              ],
              [
                'per-thread',
                `One file per Thread (${threads.length})`,
                'A folder with a full file for each Thread; shared Turns repeat',
              ],
            ] as const
          ).map(([k, label, sub]) => (
            <label
              key={k}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${shape === k ? 'border-violet-500 bg-violet-50' : 'border-zinc-200'}`}
            >
              <input
                type="radio"
                checked={shape === k}
                onChange={() => setShape(k)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-zinc-900">{label}</span>
                <span className="block text-xs text-zinc-500">{sub}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs font-medium text-zinc-500">
        Preview
        {target.kind === 'tree' && shape === 'per-thread'
          ? ' (first file)'
          : ''}
      </div>
      <MarkdownPreview text={md} />
      <div className="mt-4 flex justify-end gap-2">
        <Btn
          onClick={() => {
            toast('Copied as Markdown')
            onDone()
          }}
        >
          Copy
        </Btn>
        <Btn
          primary
          onClick={() => {
            toast(
              target.kind === 'tree' && shape === 'per-thread'
                ? `Saved folder “${slug(target.title)}/” with ${threads.length} files`
                : `Saved “${slug(target.title)}.md”`
            )
            onDone()
          }}
        >
          {target.kind === 'tree' && shape === 'per-thread'
            ? 'Save to folder…'
            : 'Save…'}
        </Btn>
      </div>
    </>
  )
}

export function ExportDialog({
  target,
  onClose,
}: {
  target: ExportTarget
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-base font-semibold text-zinc-900">
        {target.kind === 'thread'
          ? 'Export Thread'
          : `Export “${target.title}”`}
      </h2>
      <ExportBody target={target} onDone={onClose} />
    </Modal>
  )
}

// ---------- Archive ----------

export type ArchiveTarget =
  | {kind: 'tree'; treeKey: string; title: string}
  | {kind: 'everything'; keys: string[]}

export function ArchiveBody({
  target,
  onDone,
}: {
  target: ArchiveTarget
  onDone: () => void
}) {
  const toast = useToast()
  const {knobs} = useKnobs()
  const keys = target.kind === 'tree' ? [target.treeKey] : target.keys
  const parts = keys.map(archiveSize)
  const by = (k: keyof ReturnType<typeof archiveSize>) =>
    parts.reduce((s, p) => s + p[k], 0)
  const rows: [string, number][] = [
    ['Turns and System prompts', by('turns')],
    ['Attachments', by('attachments')],
    ['Workspace files, every version', by('workspace')],
    ['AI session data (so Threads continue exactly)', by('sessions')],
    ...(target.kind === 'everything'
      ? ([['Settings, System prompt library, Themes', 40_000]] as [
          string,
          number,
        ][])
      : []),
  ]
  const total = rows.reduce((s, [, n]) => s + n, 0)
  const ok = fits(total, knobs.freeBytes)
  const name =
    target.kind === 'tree'
      ? `${slug(target.title)}${EXT}`
      : `unimatrix-everything-2026-10-09${EXT}`
  return (
    <>
      <p className="text-sm text-zinc-600">
        {target.kind === 'tree'
          ? 'Everything in this Tree, in one file you can restore later, on this computer or another.'
          : `All ${keys.length} Trees plus your Settings, in one file you can restore later.`}{' '}
        Sign-ins are never included.
      </p>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map(([label, n]) => (
            <tr key={label} className="border-b border-zinc-100">
              <td className="py-1 text-zinc-600">{label}</td>
              <td className="py-1 text-right font-mono text-xs text-zinc-500">
                {n ? formatSize(n) : 'none'}
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-1.5 font-medium text-zinc-900">About</td>
            <td className="pt-1.5 text-right font-mono text-xs font-medium">
              {formatSize(total)}
            </td>
          </tr>
        </tbody>
      </table>
      {!ok && (
        <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">
          Not enough space: this needs {formatSize(total + 1e9)} free (the
          Archive plus 1 GB to spare), and only {formatSize(knobs.freeBytes)} is
          free. Save it to another drive, or free up space.
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-zinc-400">
          {name}
        </span>
        <Btn
          primary
          onClick={() => {
            toast(`Archived to “${name}”`)
            onDone()
          }}
        >
          {ok ? 'Save Archive…' : 'Save to another drive…'}
        </Btn>
      </div>
    </>
  )
}

export function ArchiveDialog({
  target,
  onClose,
}: {
  target: ArchiveTarget
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-base font-semibold text-zinc-900">
        {target.kind === 'tree'
          ? `Archive “${target.title}”`
          : 'Archive everything'}
      </h2>
      <ArchiveBody target={target} onDone={onClose} />
    </Modal>
  )
}

// ---------- Restore ----------

export type ArchivedTree =
  | {title: string; state: 'new'; turns: number}
  | {title: string; state: 'same'; turns: number}
  // Discards: what each choice throws away.
  | {
      title: string
      state: 'differs'
      turns: number
      onlyInArchive: number
      onlyInYours: number
    }

export type FakeArchive = {
  file: string
  bytes: number
  settings: boolean
  trees: ArchivedTree[]
}

export const ARCHIVES: Record<'everything' | 'one', FakeArchive> = {
  everything: {
    file: `unimatrix-everything-2026-09-14${EXT}`,
    bytes: 486e6,
    settings: true,
    trees: [
      {
        title: 'Kyoto trip plan',
        state: 'differs',
        turns: 12,
        onlyInArchive: 2,
        onlyInYours: 4,
      },
      {title: 'Kyoto questions', state: 'same', turns: 9},
      {
        title: 'Recipe site search',
        state: 'differs',
        turns: 6,
        onlyInArchive: 0,
        onlyInYours: 3,
      },
      {title: 'Lisbon move checklist', state: 'new', turns: 22},
      {title: 'Birthday party ideas', state: 'new', turns: 8},
    ],
  },
  one: {
    file: `lisbon-move-checklist${EXT}`,
    bytes: 3.1e6,
    settings: false,
    trees: [{title: 'Lisbon move checklist', state: 'new', turns: 22}],
  },
}

export type Choice = 'mine' | 'archived'

export function RestoreBody({
  archive,
  onRestore,
  onCancel,
  layout = 'list',
}: {
  archive: FakeArchive
  onRestore: (added: string[]) => void
  onCancel: () => void
  layout?: 'list' | 'compare'
}) {
  const toast = useToast()
  const {knobs} = useKnobs()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [useSettings, setUseSettings] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const added = archive.trees.filter(t => t.state === 'new')
  const same = archive.trees.filter(t => t.state === 'same')
  const differs = archive.trees.filter(t => t.state === 'differs') as Extract<
    ArchivedTree,
    {state: 'differs'}
  >[]
  const choice = (t: string) => choices[t] ?? 'mine'
  const replaced = differs.filter(t => choice(t.title) === 'archived')
  const lost = replaced.reduce((s, t) => s + t.onlyInYours, 0)
  const ok = fits(archive.bytes, knobs.freeBytes)

  const finish = () => {
    toast(
      `Restored: ${added.length} added${replaced.length ? `, ${replaced.length} replaced` : ''}${same.length ? `, ${same.length} already here` : ''}${useSettings ? ', Settings applied' : ''}`
    )
    onRestore(added.map(t => t.title))
  }

  if (confirming)
    return (
      <div>
        <h3 className="text-base font-semibold text-zinc-900">
          Replace{' '}
          {replaced.length === 1
            ? `“${replaced[0]!.title}”`
            : `${replaced.length} Trees`}{' '}
          with the archived {replaced.length === 1 ? 'copy' : 'copies'}?
        </h3>
        <p className="mt-1 text-sm text-zinc-600">
          {lost} of your Turns {lost === 1 ? 'is' : 'are'} not in the Archive
          and will be deleted, with any Workspace files only they made. This
          can’t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setConfirming(false)}>Back</Btn>
          <Btn danger onClick={finish}>
            Delete {lost} Turns and restore
          </Btn>
        </div>
      </div>
    )

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-xs text-zinc-500">
          {archive.file}
        </span>
        <span className="shrink-0 text-xs text-zinc-500">
          {archive.trees.length} Tree{archive.trees.length === 1 ? '' : 's'}
          {archive.settings ? ' + Settings' : ''}
        </span>
      </div>

      {added.length > 0 && (
        <Section title={`Will be added (${added.length})`}>
          {added.map(t => (
            <Row
              key={t.title}
              title={t.title}
              sub={`${t.turns} Turns`}
              tag="New"
              tagClass="bg-emerald-100 text-emerald-800"
            />
          ))}
        </Section>
      )}
      {differs.length > 0 && (
        <Section title={`Different from yours (${differs.length})`}>
          {differs.map(t =>
            layout === 'compare' ? (
              <CompareRow
                key={t.title}
                t={t}
                value={choice(t.title)}
                onChange={c => setChoices(s => ({...s, [t.title]: c}))}
              />
            ) : (
              <div
                key={t.title}
                className="rounded-lg border border-zinc-200 p-2.5"
              >
                <div className="text-sm font-medium text-zinc-900">
                  {t.title}
                </div>
                <div className="mt-1.5 flex flex-col gap-1 text-sm">
                  {(
                    [
                      [
                        'mine',
                        'Keep mine',
                        t.onlyInArchive
                          ? `skips ${t.onlyInArchive} archived Turns yours doesn’t have`
                          : 'yours already has every archived Turn',
                      ],
                      [
                        'archived',
                        'Use archived',
                        t.onlyInYours
                          ? `deletes ${t.onlyInYours} of your Turns`
                          : 'nothing of yours is lost',
                      ],
                    ] as const
                  ).map(([k, label, sub]) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <input
                        type="radio"
                        checked={choice(t.title) === k}
                        onChange={() => setChoices(s => ({...s, [t.title]: k}))}
                      />
                      <span className="text-zinc-800">{label}</span>
                      <span
                        className={`text-xs ${k === 'archived' && t.onlyInYours ? 'text-red-600' : 'text-zinc-500'}`}
                      >
                        {sub}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          )}
        </Section>
      )}
      {same.length > 0 && (
        <Section title={`Already here, skipped (${same.length})`}>
          {same.map(t => (
            <Row key={t.title} title={t.title} sub="Identical to yours" muted />
          ))}
        </Section>
      )}

      {archive.settings && (
        <label className="mt-4 flex items-start gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={useSettings}
            onChange={e => setUseSettings(e.target.checked)}
            className="mt-1"
          />
          <span>
            Also use the Settings from this archive
            <span className="block text-xs text-zinc-500">
              Replaces your Settings, System prompt library and Themes. Sign-ins
              are never in an Archive.
            </span>
          </span>
        </label>
      )}

      <div
        className={`mt-4 rounded-lg px-3 py-2 text-xs ${ok ? 'bg-zinc-50 text-zinc-600' : 'bg-red-50 text-red-800'}`}
      >
        {ok
          ? `Restoring writes about ${formatSize(archive.bytes)}. ${formatSize(knobs.freeBytes)} free.`
          : `Restoring needs ${formatSize(archive.bytes + 1e9)} free (the Archive plus 1 GB to spare); only ${formatSize(knobs.freeBytes)} is free.`}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          primary
          disabled={!ok || (!added.length && !replaced.length && !useSettings)}
          onClick={() => (lost ? setConfirming(true) : finish())}
        >
          Restore
        </Btn>
      </div>
    </div>
  )
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function Row({
  title,
  sub,
  tag,
  tagClass,
  muted,
}: {
  title: string
  sub: string
  tag?: string
  tagClass?: string
  muted?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm ${muted ? 'text-zinc-400' : 'text-zinc-800'}`}
    >
      <span className="flex-1 truncate">{title}</span>
      <span className="text-xs text-zinc-500">{sub}</span>
      {tag && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${tagClass}`}>
          {tag}
        </span>
      )}
    </div>
  )
}

function CompareRow({
  t,
  value,
  onChange,
}: {
  t: Extract<ArchivedTree, {state: 'differs'}>
  value: Choice
  onChange: (c: Choice) => void
}) {
  const yours = t.turns - t.onlyInArchive + t.onlyInYours
  const card = (
    c: Choice,
    label: string,
    turns: number,
    note: string,
    bad: boolean
  ) => (
    <button
      onClick={() => onChange(c)}
      className={`flex-1 rounded-lg border-2 p-2.5 text-left ${value === c ? 'border-violet-500 bg-violet-50' : 'border-zinc-200 hover:bg-zinc-50'}`}
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-sm font-medium text-zinc-900">{turns} Turns</div>
      <div
        className={`mt-0.5 text-xs ${bad ? 'text-red-600' : 'text-zinc-500'}`}
      >
        {note}
      </div>
    </button>
  )
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5">
      <div className="mb-1.5 text-sm font-medium text-zinc-900">{t.title}</div>
      <div className="flex gap-2">
        {card(
          'mine',
          'Keep mine',
          yours,
          t.onlyInArchive
            ? `${t.onlyInArchive} archived Turns not kept`
            : 'Loses nothing',
          false
        )}
        {card(
          'archived',
          'Use archived',
          t.turns,
          t.onlyInYours
            ? `${t.onlyInYours} of your Turns deleted`
            : 'Loses nothing',
          t.onlyInYours > 0
        )}
      </div>
    </div>
  )
}

// Dragging any file onto the window stands in for dragging an Archive.
export function useArchiveDrop(onDrop: () => void) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setOver(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overFn = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setOver(false)
      onDrop()
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [onDrop])
  return over
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-3 z-[80] flex items-center justify-center rounded-3xl border-4 border-dashed border-violet-500 bg-violet-50/85">
      <div className="text-center">
        <div className="text-4xl">📦</div>
        <div className="mt-2 text-lg font-semibold text-violet-900">
          Drop to restore
        </div>
        <div className="text-sm text-violet-700">
          You’ll see what’s inside before anything changes
        </div>
      </div>
    </div>
  )
}

// ---------- Summaries ----------

export const MODELS = [
  {name: 'Claude Sonnet 5', provider: 'Claude', window: 200_000},
  {name: 'Claude Opus 5', provider: 'Claude', window: 200_000},
  {name: 'Claude Haiku 5', provider: 'Claude', window: 200_000},
  {name: 'GPT-5.5', provider: 'ChatGPT', window: 272_000},
  {name: 'GPT-5.5 mini', provider: 'ChatGPT', window: 272_000},
]
const providerOf = (model?: string) =>
  model?.startsWith('GPT') ? 'ChatGPT' : 'Claude'
export const DEFAULT_SUMMARY_MODEL = 'Claude Sonnet 5'

export type SummaryTarget =
  | {kind: 'thread'; treeKey: string; replyId: string; title: string}
  | {kind: 'tree'; treeKey: string; title: string}

export function summaryPlan(
  target: SummaryTarget,
  model: string,
  huge: boolean
) {
  const tree = simCache.get(target.treeKey)!.tree
  const m = MODELS.find(x => x.name === model)!
  if (target.kind === 'thread') {
    const reply = tree[target.replyId]!
    const tokens = contextSize(tree, target.replyId)
    // Forking the Reply's own session reuses its cache; another Provider replays the Thread first.
    const reread = providerOf(reply.model) !== m.provider ? tokens : 0
    return {tokens, parts: 1, reread}
  }
  const tokens = treeTokens(tree, huge)
  const room = m.window * 0.8
  return {
    tokens,
    parts: tokens <= room ? 1 : Math.ceil(tokens / room),
    reread: 0,
  }
}

export function SummaryOptions({
  target,
  model,
  onModel,
}: {
  target: SummaryTarget
  model: string
  onModel: (m: string) => void
}) {
  const {knobs} = useKnobs()
  const plan = summaryPlan(target, model, knobs.hugeTree)
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="w-14 text-zinc-500">Model</span>
        <select
          value={model}
          onChange={e => onModel(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1"
        >
          {MODELS.map(m => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </label>
      <div className="text-xs text-zinc-600">
        Reads ~{formatTokens(plan.tokens)} tokens
        {plan.parts > 1 && (
          <>
            , in {plan.parts} parts{' '}
            <span className="text-zinc-400">
              (split at Forks, 3 at a time, then combined)
            </span>
          </>
        )}
        . Counts toward your {providerOf(model)} usage.
      </div>
      {plan.reread > 0 && (
        <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {providerOf(model)} will re-read ~{formatTokens(plan.reread)} tokens
          first, because this Thread was with another Provider.
        </div>
      )}
      <div className="text-[11px] text-zinc-400">
        Made outside the Tree. The AI in this Tree never sees it. Prompt:
        Settings → Chat → Summary prompts.
      </div>
    </div>
  )
}

export function summaryTitle(target: SummaryTarget) {
  if (target.kind === 'tree') return `Summary of “${target.title}”`
  const tree = simCache.get(target.treeKey)!.tree
  const prompt = tree[tree[target.replyId]!.parentId!]
  return `Summary up to “${prompt?.text.split('\n')[0]!.slice(0, 32) ?? '…'}”`
}

function summaryText(target: SummaryTarget) {
  const tree = simCache.get(target.treeKey)!.tree
  const prompts =
    target.kind === 'thread'
      ? pathTo(tree, target.replyId).filter(t => t.kind === 'prompt')
      : turnsOf(tree).filter(t => t.kind === 'prompt')
  const branches = leavesOf(tree).length
  return [
    target.kind === 'tree'
      ? `This Tree explores ${prompts.length} questions across ${branches} Branches.`
      : `This Thread covers ${prompts.length} Prompt${prompts.length === 1 ? '' : 's'}.`,
    '',
    '**What was asked**',
    ...prompts.slice(0, 6).map(p => `- ${p.text.split('\n')[0]!.slice(0, 90)}`),
    '',
    '**Where it landed**',
    '- The plan settled on staying near the station, with day trips planned around the weather.',
    '- Costs were compared in two Branches; the cheaper option gave up the ryokan night.',
    '- Still open: which temples need booking ahead, and whether the rail pass pays off.',
  ].join('\n')
}

export type SummaryRun = {
  target: SummaryTarget
  model: string
  status: 'running' | 'done' | 'stopped'
  phase: 'reading' | 'combining' | 'writing'
  partsDone: number
  parts: number
  text: string
  kept: boolean
  stop: () => void
  keep: (how: 'copy' | 'save') => void
}

export function useSummaryRun(
  target: SummaryTarget | null,
  model: string,
  started: boolean
): SummaryRun | null {
  const toast = useToast()
  const {knobs} = useKnobs()
  const [s, setS] = useState({
    status: 'running' as SummaryRun['status'],
    phase: 'reading' as SummaryRun['phase'],
    partsDone: 0,
    text: '',
    kept: false,
  })
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const plan = useMemo(
    () => (target ? summaryPlan(target, model, knobs.hugeTree) : null),
    [target, model, knobs.hugeTree]
  )

  useEffect(() => {
    if (!target || !started || !plan) return
    const full = summaryText(target).split(/(\s+)/)
    let i = 0
    let tick = 0
    setS({
      status: 'running',
      phase: plan.parts > 1 ? 'reading' : 'writing',
      partsDone: 0,
      text: '',
      kept: false,
    })
    timer.current = setInterval(() => {
      tick++
      setS(cur => {
        if (cur.phase === 'reading') {
          // Three parts at a time, each a few ticks.
          const done = Math.min(plan.parts, Math.floor(tick / 6) * 3)
          return done >= plan.parts
            ? {...cur, partsDone: plan.parts, phase: 'combining'}
            : {...cur, partsDone: done}
        }
        if (cur.phase === 'combining')
          return tick % 8 === 0 ? {...cur, phase: 'writing'} : cur
        i += 2
        if (i >= full.length) {
          clearInterval(timer.current)
          return {...cur, text: full.join(''), status: 'done'}
        }
        return {...cur, text: full.slice(0, i).join('')}
      })
    }, 70)
    return () => clearInterval(timer.current)
  }, [target, started, plan])

  if (!target || !started || !plan) return null
  return {
    target,
    model,
    ...s,
    parts: plan.parts,
    stop: () => {
      clearInterval(timer.current)
      setS(cur =>
        cur.status === 'running' ? {...cur, status: 'stopped'} : cur
      )
    },
    keep: how => {
      toast(how === 'copy' ? 'Summary copied' : 'Saved “summary.md”')
      setS(cur => ({...cur, kept: true}))
    },
  }
}

// Esc stops a running Summary before the canvas sees it.
export function useEscStops(run: SummaryRun | null) {
  useEffect(() => {
    if (run?.status !== 'running') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      run.stop()
    }
    window.addEventListener('keydown', onKey, {capture: true})
    return () => window.removeEventListener('keydown', onKey, {capture: true})
  }, [run])
}

export function SummaryProgress({run}: {run: SummaryRun}) {
  if (run.status !== 'running' || run.phase === 'writing') return null
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full bg-violet-500 transition-all"
          style={{
            width:
              run.phase === 'combining'
                ? '100%'
                : `${(run.partsDone / run.parts) * 100}%`,
          }}
        />
      </div>
      {run.phase === 'reading'
        ? `${run.partsDone} of ${run.parts} parts read, 3 at a time`
        : 'Combining parts…'}
    </div>
  )
}

export function SummaryText({run}: {run: SummaryRun}) {
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-800">
      {run.text
        .split(/(\*\*[^*\n]+\*\*)/)
        .map((bit, i) =>
          bit.startsWith('**') && bit.endsWith('**') ? (
            <strong key={i}>{bit.slice(2, -2)}</strong>
          ) : (
            bit
          )
        )}
      {run.status === 'running' && run.phase === 'writing' && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-violet-500 align-middle" />
      )}
      {run.status === 'stopped' && (
        <div className="mt-2 text-xs text-amber-700">
          Stopped. What’s here is kept until you close it.
        </div>
      )}
    </div>
  )
}

export function SummaryActions({
  run,
  onClose,
}: {
  run: SummaryRun
  onClose: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (asking)
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-zinc-700">Discard this summary?</span>
        <Btn onClick={() => setAsking(false)}>Keep</Btn>
        <Btn danger onClick={onClose}>
          Discard
        </Btn>
      </div>
    )
  return (
    <div className="flex items-center gap-2">
      {run.status === 'running' ? (
        <Btn onClick={run.stop}>
          Stop <span className="text-xs text-zinc-400">Esc</span>
        </Btn>
      ) : (
        <>
          <Btn onClick={() => run.keep('copy')}>Copy</Btn>
          <Btn onClick={() => run.keep('save')}>Save as Markdown…</Btn>
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={() => (run.kept || !run.text ? onClose() : setAsking(true))}
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        Close
      </button>
    </div>
  )
}

// ---------- Settings ----------

const SECTIONS = [
  'Appearance',
  'Chat',
  'System prompts',
  'Tools',
  'Connections',
  'Storage',
  'Updates & About',
]

export function SettingsPage({
  archiveSection,
  initial,
  onClose,
  onArchiveEverything,
  onRestore,
  leftInset,
}: {
  // Where Archive everything and Restore live: their own section, or inside Storage.
  archiveSection: {name: string} | 'storage'
  initial?: string
  onClose: () => void
  onArchiveEverything: () => void
  onRestore: () => void
  leftInset: number
}) {
  const sections =
    archiveSection === 'storage'
      ? SECTIONS
      : [...SECTIONS.slice(0, 6), archiveSection.name, ...SECTIONS.slice(6)]
  const own = archiveSection === 'storage' ? null : archiveSection.name
  const [at, setAt] = useState(initial ?? own ?? 'Storage')
  const archiveBlock = (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-zinc-200 p-4">
        <div className="font-medium text-zinc-900">Archive everything</div>
        <p className="mt-0.5 text-sm text-zinc-600">
          Every Tree, with its files and history, plus these Settings, your
          System prompt library and Themes, in one file. Sign-ins aren’t
          included. To archive one Tree, use its menu.
        </p>
        <Btn primary className="mt-3" onClick={onArchiveEverything}>
          Archive everything…
        </Btn>
      </div>
      <div className="rounded-xl border border-zinc-200 p-4">
        <div className="font-medium text-zinc-900">Restore from an Archive</div>
        <p className="mt-0.5 text-sm text-zinc-600">
          You’ll see what’s inside first. New Trees are added; for ones you
          already have, you choose. You can also drag an Archive onto the
          window, or double-click a{' '}
          <span className="font-mono text-xs">{EXT}</span> file.
        </p>
        <Btn className="mt-3" onClick={onRestore}>
          Restore…
        </Btn>
      </div>
    </div>
  )
  return (
    <div
      style={{left: leftInset}}
      className="fixed inset-y-0 right-0 z-[45] flex bg-white"
    >
      <nav className="w-52 shrink-0 border-r border-zinc-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Settings</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        {sections.map(s => (
          <button
            key={s}
            onClick={() => setAt(s)}
            className={`block w-full rounded-md px-2 py-1 text-left text-sm ${at === s ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            {s}
          </button>
        ))}
      </nav>
      <div className="max-w-2xl flex-1 overflow-y-auto p-6">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">{at}</h2>
        {at === own && archiveBlock}
        {at === 'Storage' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600">
              <div className="font-medium text-zinc-900">This computer</div>
              The app uses 1.3 GB. 212 GB free on Macintosh HD.
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full w-[8%] bg-violet-500" />
              </div>
            </div>
            {archiveSection === 'storage' && (
              <>
                <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Archives
                </div>
                {archiveBlock}
              </>
            )}
          </div>
        )}
        {at === 'Chat' && (
          <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600">
            <div className="font-medium text-zinc-900">Summary prompts</div>
            Thread summary and Tree summary prompts are editable here (not
            prototyped).
          </div>
        )}
        {at !== own && at !== 'Storage' && at !== 'Chat' && (
          <p className="text-sm text-zinc-400">Not part of this prototype.</p>
        )}
      </div>
    </div>
  )
}

// ---------- prototype chrome ----------

export function KnobsPanel({
  onDrop,
  onOpenFile,
}: {
  onDrop: (a: keyof typeof ARCHIVES) => void
  onOpenFile: () => void
}) {
  const {knobs, setKnobs} = useKnobs()
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed right-3 bottom-3 z-[55] flex flex-col-reverse items-end font-mono text-[11px] text-fuchsia-950">
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-3 py-1 shadow"
      >
        PROTOTYPE · Export & Archive {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mb-1 flex w-72 flex-col gap-1.5 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-2.5 shadow">
          <div>
            Simulate an Archive arriving (or drag any file onto the window):
          </div>
          <button
            onClick={() => onDrop('everything')}
            className="rounded border border-fuchsia-400 px-2 py-0.5 text-left hover:bg-fuchsia-100"
          >
            Drop “Archive everything” (5 Trees + Settings)
          </button>
          <button
            onClick={() => onDrop('one')}
            className="rounded border border-fuchsia-400 px-2 py-0.5 text-left hover:bg-fuchsia-100"
          >
            Drop a one-Tree Archive
          </button>
          <button
            onClick={onOpenFile}
            className="rounded border border-fuchsia-400 px-2 py-0.5 text-left hover:bg-fuchsia-100"
          >
            Double-click a {EXT} file in Finder
          </button>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={knobs.freeBytes < 1e9}
              onChange={e =>
                setKnobs({
                  ...knobs,
                  freeBytes: e.target.checked ? 800e6 : 212e9,
                })
              }
            />
            Low disk (800 MB free)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={knobs.hugeTree}
              onChange={e => setKnobs({...knobs, hugeTree: e.target.checked})}
            />
            Pretend Trees are huge (×400 tokens)
          </label>
        </div>
      )}
    </div>
  )
}
