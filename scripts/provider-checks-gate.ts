/**
 * CI's gate on a bump PR: red until the repo owner's `bun run provider-checks`
 * result for the PR's head commit passes. Every other run passes.
 */
import type {Comment} from './provider-checks-result.ts'

import {z} from 'zod'

import {gateVerdict} from './provider-checks-result.ts'
import {bumpOf} from './vendor-pins.ts'

const Env = z.object({
  GITHUB_EVENT_NAME: z.string(),
  GITHUB_EVENT_PATH: z.string(),
  GITHUB_REPOSITORY: z.string(),
  GITHUB_REPOSITORY_OWNER: z.string(),
  GITHUB_TOKEN: z.string(),
})

const PullRequestEvent = z.looseObject({
  pull_request: z.looseObject({
    number: z.number(),
    base: z.looseObject({sha: z.string()}),
    head: z.looseObject({sha: z.string()}),
  }),
})

const Comments = z.array(
  z.looseObject({user: z.looseObject({login: z.string()}), body: z.string()})
)

const env = Env.parse(process.env)

async function api(path: string) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
    },
  })

  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`)

  return response.text()
}

async function commentsOn(pr: number) {
  const comments: Comment[] = []

  for (let page = 1; ; page++) {
    const batch = Comments.parse(
      JSON.parse(
        await api(
          `repos/${env.GITHUB_REPOSITORY}/issues/${pr}/comments?per_page=100&page=${page}`
        )
      )
    )

    comments.push(...batch.map(({user, body}) => ({login: user.login, body})))

    if (batch.length < 100) return comments
  }
}

if (env.GITHUB_EVENT_NAME !== 'pull_request') {
  console.log(`Not a PR (${env.GITHUB_EVENT_NAME}): nothing to gate.`)
  process.exit(0)
}

const {pull_request: pr} = PullRequestEvent.parse(
  await Bun.file(env.GITHUB_EVENT_PATH).json()
)

const changes = await bumpOf(api, env.GITHUB_REPOSITORY, {
  base: pr.base.sha,
  head: pr.head.sha,
})

if (changes.length === 0) {
  console.log('This PR moves no vendor pin: nothing to gate.')
  process.exit(0)
}

console.log(`A bump PR: ${changes.join(', ')}.`)

const verdict = gateVerdict({
  owner: env.GITHUB_REPOSITORY_OWNER,
  head: pr.head.sha,
  comments: await commentsOn(pr.number),
})

if (!verdict.pass) {
  console.error(verdict.reason)
  process.exit(1)
}

console.log(verdict.reason)
