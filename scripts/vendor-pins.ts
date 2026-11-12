/**
 * The vendor pins, and whether a PR changes them. A bump PR is known by what it
 * changes, never by its branch or labels, which a fork can copy.
 */
import {z} from 'zod'

export const MANIFEST = 'app/main/src/modules/vendor-programs/dev-manifest.json'
export const HOST_PACKAGE = 'app/provider-host/package.json'
const SDK = '@anthropic-ai/claude-agent-sdk'

const Manifest = z.looseObject({
  vendorPrograms: z.record(z.string(), z.looseObject({version: z.string()})),
})

const HostPackage = z.looseObject({
  dependencies: z.looseObject({[SDK]: z.string()}),
})

export function pinsOf(manifest: string, hostPackage: string) {
  const {vendorPrograms} = Manifest.parse(JSON.parse(manifest))
  const {dependencies} = HostPackage.parse(JSON.parse(hostPackage))

  return new Map([
    ...Object.entries(vendorPrograms).map(
      ([name, {version}]) => [name, version] as const
    ),
    [SDK, dependencies[SDK]] as const,
  ])
}

type Pins = ReturnType<typeof pinsOf>

/** Each pin `head` moves, as `<name> <from> → <to>`. */
function pinChanges(base: Pins, head: Pins) {
  const names = new Set([...base.keys(), ...head.keys()])

  return [...names].flatMap(name =>
    base.get(name) === head.get(name)
      ? []
      : [`${name} ${base.get(name) ?? 'none'} → ${head.get(name) ?? 'none'}`]
  )
}

/**
 * A GitHub REST GET: the path after `https://api.github.com/`, its JSON text
 * back.
 */
export type GitHubApi = (path: string) => Promise<string>

const Compare = z.looseObject({
  merge_base_commit: z.looseObject({sha: z.string()}),
})

const Contents = z.looseObject({content: z.string()})

async function pinsAt(api: GitHubApi, repo: string, sha: string) {
  const [manifest, hostPackage] = await Promise.all(
    [MANIFEST, HOST_PACKAGE].map(async file => {
      const {content} = Contents.parse(
        JSON.parse(await api(`repos/${repo}/contents/${file}?ref=${sha}`))
      )

      return Buffer.from(content, 'base64').toString('utf8')
    })
  )

  return pinsOf(manifest ?? '', hostPackage ?? '')
}

/**
 * The pins a PR moves from where it branched off `base`. Read whole, since
 * GitHub's list of a PR's changed files stops at 300.
 */
export async function bumpOf(
  api: GitHubApi,
  repo: string,
  pr: {base: string; head: string}
) {
  const compared = Compare.parse(
    JSON.parse(await api(`repos/${repo}/compare/${pr.base}...${pr.head}`))
  )

  const [base, head] = await Promise.all([
    pinsAt(api, repo, compared.merge_base_commit.sha),
    pinsAt(api, repo, pr.head),
  ])

  return pinChanges(base, head)
}
