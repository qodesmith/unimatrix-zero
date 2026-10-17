# 1. Product

**Audience.** A software engineer, a stay-at-home parent and a child should all find it easy. Users never see or need to know about a terminal; no copy mentions a terminal, an install or a CLI. Power users are never artificially limited.

**Money.** Subscription sign-in only, never API keys; it works on the $20 plans (Claude Pro, ChatGPT Plus). No paid developer accounts, no app stores, no user accounts, no paid infrastructure and none the app needs in order to work. Free, stateless, optional services that hold no user data are allowed (the Report relay, [ADR 0017](../../adr/0017-reports-go-through-a-stateless-relay-into-github-issues.md)). The app is MIT licensed and the repo is public.

**Terms.** The Claude connection ships regardless of the ambiguity in Anthropic's third-party wording, with T3 Code as precedent. No approval request, no disclosure in the app or README. Providers are pluggable, so a ChatGPT-only user is fully supported. ([Staying within Anthropic's subscription terms](https://github.com/qodesmith/unimatrix-zero/issues/21))

**Precedents.** T3 Code for the subscription approach (wrapping the vendor CLI or SDK) and tldraw for the canvas feel.

**Stack.** Electron, Bun for development only, React, Tailwind and shadcn, SQLite through Drizzle, React Flow for the canvas, TanStack Query and TanStack Store, Streamdown for Markdown. No AI library ([ADR 0005](../../adr/0005-no-ai-library.md)).
