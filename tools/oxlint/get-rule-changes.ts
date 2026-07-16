import {spawn} from 'bun'

import reviewedOxlintVersion from './reviewed-oxlint-version.json' with {type: 'json'}

async function getRuleChangesWithClaude() {
  const {version} = reviewedOxlintVersion
  const timeLabel = 'Total time taken:'

  // oxlint-disable-next-line no-console
  console.time(timeLabel)

  const prompt = [
    'Use `gh release list -R oxc-project/oxc` and ',
    '`gh release view <tag> -R oxc-project/oxc` to inspect oxlint releases ',
    `for any versions newer than "${version}". For all newer versions, check `,
    'the release notes for 4 things: new rules added, rules updated, rules ',
    'fixed, and rules deprecated. Aggregate the results into 4 lists and ',
    'append a section at the bottom stating what versions constitute these ',
    "changes. If we're on the current release, simply reply ",
    `"On the latest oxlint release - ${version}"`,
  ].join('')

  // Use the CLI to run `claude -p` with this prompt, streaming output as it
  // arrives. stream-json + partial messages emits token-level deltas we can
  // print live. -p can't prompt interactively, so instead of skipping all
  // permissions we pre-grant the narrowest set this prompt needs: only the
  // read-only `gh release list`/`gh release view` subcommands (NOT all of
  // `gh` — that would hand the write-scoped CI token to a tool the agent could
  // be prompt-injected into abusing) plus WebFetch for the release-notes URLs.
  //
  // In CI this runs against a PR-controlled working tree, so we also refuse to
  // load any repo-provided config the PR could weaponize: `--strict-mcp-config`
  // ignores `.mcp.json`, and `--settings '{}'` overrides project settings
  // (hooks in particular execute regardless of --allowedTools). The workflow
  // additionally strips `.claude`/`.mcp.json` and isolates CLAUDE_CONFIG_DIR.
  const child = spawn(
    [
      'claude',
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config',
      '--settings',
      '{}',
      '--allowedTools',
      'Bash(gh release list:*) Bash(gh release view:*) WebFetch',
    ],
    {stdin: 'inherit', stdout: 'pipe', stderr: 'inherit'}
  )

  // Print assistant text as it streams in token by token.
  const printTextDelta = (line: string) => {
    if (!line.trim()) return

    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }

    if (
      typeof event === 'object' &&
      event !== null &&
      'event' in event &&
      typeof (event as {event: unknown}).event === 'object'
    ) {
      const inner = (event as {event: Record<string, unknown>}).event
      if (
        inner.type === 'content_block_delta' &&
        typeof inner.delta === 'object' &&
        inner.delta !== null &&
        (inner.delta as {type?: unknown}).type === 'text_delta'
      ) {
        process.stdout.write((inner.delta as {text: string}).text)
      }
    }
  }

  // Piped stdout is an async-iterable byte stream; re-chunk it into the NDJSON
  // lines the stream-json format emits.
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of child.stdout) {
    pending += decoder.decode(chunk, {stream: true})
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) printTextDelta(line)
  }
  printTextDelta(pending)

  const code = await child.exited
  process.stdout.write('\n\n')

  // oxlint-disable-next-line no-console
  console.timeEnd(timeLabel)

  if (code !== 0) {
    throw new Error(`claude exited with code ${code}`)
  }
}

await getRuleChangesWithClaude()
