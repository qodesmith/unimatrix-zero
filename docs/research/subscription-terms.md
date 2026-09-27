# Subscription terms: can a free third-party app drive Claude and ChatGPT subscriptions?

Researched 2026-09-27. Follows up the "Terms" sections of `research/subscription-session-capabilities` and `research/hidden-sign-in`.

**Question:** Unimatrix Zero is a free Electron app that spawns the vendors' unmodified CLIs (`claude` through `@anthropic-ai/claude-agent-sdk`, `codex app-server`). Sign-in happens inside those binaries. Is that allowed by Anthropic's and OpenAI's current terms, and does it matter whether we bundle the binaries or use a copy the user installed?

**Method.** Anthropic docs were fetched as Markdown from `code.claude.com` and legal pages from `anthropic.com` on 2026-09-27. openai.com returns 403 to scripts, so the OpenAI Terms of Use, Service Terms and Usage Policies come from Wayback snapshots dated 2026-09-25 and 2026-09-26. Codex docs were fetched from `learn.chatgpt.com/docs/*.md`. X posts were read through `api.fxtwitter.com`, which returns the original post's text and timestamp, and threads through threadreaderapp.com. Where a claim appears only in press coverage, it is labelled **[secondary]** or **[unverified]**.

---

## TL;DR

| | Claude | ChatGPT (Codex) |
| --- | --- | --- |
| Written rules | Unchanged since the earlier research and still contradictory. The Agent SDK docs say third parties may not "offer claude.ai login" "unless previously approved". The legal page forbids offering Claude.ai login but allows "an end user … signing in to the unmodified Claude Code binary with their own Claude subscription". | Silent. No term addresses third-party apps. The app-server docs describe it for "a deep integration inside your own product", including ChatGPT login. |
| What the vendor actually does | Tolerates Agent SDK-based third-party apps. A help-center article dated 2026-06-16 says "third-party app usage still draw[s] from your subscription's usage limits". @ClaudeDevs said "third-party tools built on the Agent SDK like Conductor and OpenClaw work with your Claude plan". Enforcement so far has hit tools that **spoofed** Claude Code with the raw OAuth token (OpenCode), not tools that run the real binary. | Endorses it. The Codex lead said "You are completely fine if you use your subscription through Sign in With ChatGPT, either through the official clients or through one of the many OSS clients". |
| Approval route | None published. The only contacts given are "contact sales" and a staff member's X DMs. | Not needed. Enterprise integrations are asked to "contact OpenAI to get it added to a known clients list". |
| Bundling the binary | "Preinstalling or running Claude Code in your products" requires the Commercial Terms. Bundling the SDK's `claude` clearly counts as "preinstalling"; spawning the user's own copy arguably still counts as "running". | Apache-2.0. Keep LICENSE and NOTICE; there is no other restriction. |
| Risk | Medium, and policy-driven. Anthropic has changed direction three times in 2026 and "reserves the right to take measures … without prior notice". | Low. |

---

## Q1. Current Anthropic wording

### Agent SDK overview: unchanged

<https://code.claude.com/docs/en/agent-sdk/overview.md>, retrieved 2026-09-27:

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the [Quickstart](/docs/en/agent-sdk/quickstart) instead.

The same note, with "Please use…" at the end, is in the Quickstart (<https://code.claude.com/docs/en/agent-sdk/quickstart.md>).

The same page, "License and terms":

> Use of the Claude Agent SDK is governed by [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), including when you use it to power products and services that you make available to your own customers and end users, except to the extent a specific component or dependency is covered by a different license as indicated in that component's LICENSE file.

The same page, "Branding guidelines", lists "Claude Code" and "Claude Code Agent" as names you may not use, and says: "Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product. For questions about branding compliance, contact the Anthropic [sales team]".

The npm package's `LICENSE.md` (`@anthropic-ai/claude-agent-sdk@0.3.283`): "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance."

### Claude Code legal and compliance: unchanged

<https://code.claude.com/docs/en/legal-and-compliance.md>, retrieved 2026-09-27. The earlier quotes are word for word the same. The full relevant text:

"License":

> Your use of Claude Code is subject to:
> * Commercial Terms of Service - for Team, Enterprise, and Claude API users
> * Consumer Terms of Service - for Free, Pro, and Max users

"Can customers offer Claude Code in their products?":

> Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below:
>
> * **The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> * **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (…). That usage is billed directly to the end user under their own agreement with Anthropic or, for third-party inference providers, with the applicable provider.
>
> **Using the Claude Code name and logo.** You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product.

"Acceptable use":

> Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

"Authentication and credential use":

> * **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. …
> * **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.
>
> This does not restrict how customers provision and manage their own API keys … Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.
>
> For questions about permitted authentication methods for your use case, please [contact sales](https://www.anthropic.com/contact-sales?utm_source=claude_code&utm_medium=docs&utm_content=legal_compliance_contact_sales).

### Consumer Terms: unchanged

<https://www.anthropic.com/legal/consumer-terms>, "Effective October 8, 2025", retrieved 2026-09-27. These govern the end user, because Pro and Max are consumer plans.

> You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else.

Among the prohibited uses:

> Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.

> To develop any products or services that compete with our Services, … or resell the Services.

> You also must not abuse, harm, interfere with, or disrupt our Services, including, for example, … bypassing any of our systems or protective measures.

### Usage Policy

<https://www.anthropic.com/legal/aup>, "Effective September 15, 2025", retrieved 2026-09-27. Nothing in it addresses third-party clients. The closest line is "Intentionally bypass capabilities, restrictions, or guardrails established within our products".

### Service Specific Terms

<https://www.anthropic.com/legal/service-specific-terms>, "Effective August 31, 2026". These have no Claude Code or Agent SDK section; the page's only mentions of "Claude Code" are in the site navigation. The old `/legal/service-terms` URL returns 404.

### Help center: new since the earlier research, and important

"Use the Claude Agent SDK with your Claude plan", <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>, dated June 16, 2026, retrieved 2026-09-27:

> Update June 15: We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits. The previously announced monthly credit, which would have been available to eligible claimants in connection with these changes, isn't available. We're working to update the plan to better support how users build with Claude subscriptions. When we have an update, we'll share it before anything takes effect.

The "preserved for reference" part of the same article, which did not take effect, lists among what the credit covers:

> Third-party apps that authenticate with your Claude subscription through the Agent SDK

and says:

> The Agent SDK monthly credit is sized for individual experimentation and automation. Teams running shared production automation should use Claude Platform with an API key

"Use Claude Code with your Pro or Max plan", <https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan>, dated August 19, 2026, covers only the terminal and IDEs and says nothing about third-party apps.

### Has anything changed?

- **The legal texts:** no. The Agent SDK note, the legal page and the Consumer Terms match the earlier quotes word for word.
- **What has changed is Anthropic's stated practice.** It now documents, in a first-party help article, that "third-party apps that authenticate with your Claude subscription through the Agent SDK" exist and bill against subscription limits. The formal ban and the operational acceptance now sit side by side.

### Is there an approval process for "previously approved"?

**None published.** The only routes found:

- "contact sales" on the legal page (for "questions about permitted authentication methods") and on the SDK overview (for branding).
- Thariq Shihipar (Anthropic, Claude Code), 2026-01-09: "If you're a maintainer of a third-party tool and want to chat about integration paths, my DMs are open." (<https://x.com/trq212/status/2009689813394629036>, via [thread](https://threadreaderapp.com/thread/2009689809875591565.html))

---

## Q2. The Commercial Terms, and whether they cover us

<https://www.anthropic.com/legal/commercial-terms>, "Effective June 17, 2025", retrieved 2026-09-27. The key points:

- **Who is bound:** "an agreement between Anthropic and you or the organization, company, or other entity that you represent ('Customer')". An individual can be the Customer.
- **How you accept:** "These Terms are effective on the earlier of the date that Customer first electronically consents to a version of these Terms and the date that Customer first accesses the Services". In practice you accept by creating a Claude Console (API) account.
- **Consumers are excluded:** "Services under these Terms are not for consumer use. Our consumer offerings (e.g., Claude.ai) are governed by our Consumer Terms of Service instead."
- **A.1:** "Anthropic gives Customer permission to use the Services, including to power products and services Customer makes available to its own customers and end users ('Users')."
- **D.2:** Customer and its Users must comply with the Usage Policy, the Supported Regions Policy and the Service Specific Terms. "Customer must cooperate with reasonable requests for information from Anthropic … including to verify Customer's identity and use of the Services."
- **D.3:** Customer "must notify its Users, that factual assertions in Outputs should not be relied upon without independently checking their accuracy".
- **D.4:** no competing product, no reverse engineering, no reselling "except as expressly approved by Anthropic".
- **G. Publicity:** Anthropic may name you as a customer (you can opt out).
- **H. Fees:** "Customer is responsible for fees incurred by its account". There is no fee just for being bound.
- **I.2.a:** either party may terminate "at any time for convenience with Notice, except Anthropic must provide 30 days prior Notice".
- **K.2 (you indemnify Anthropic):** Customer "will defend Anthropic … from and against any Anthropic Claim", meaning third-party claims "related to Customer's or its Users' (a) Inputs … or (b) use of the Services in violation of the Usage Policy, the Service Specific Terms, or Section D.4". **This is the one clause with real personal exposure for a solo developer**, because it covers what your users do.

**Could a free individual developer realistically accept them? Yes.** They are click-through terms with no minimum spend, no organisation requirement and no approval step. They impose ordinary obligations: tell users that outputs may be inaccurate, follow the Usage Policy, and indemnify Anthropic for users' policy violations. Accepting them does **not** by itself grant the "previously approved" status the SDK note mentions. The legal page presents the Commercial Terms plus its two conditions as the route for "running Claude Code in your products". The authentication section says that route is compatible with "an end user … signing in to the unmodified Claude Code binary with their own Claude subscription".

**Does "running Claude Code in your products" cover spawning a user-installed binary? Plausibly yes. [interpretation]**

- The wording is "preinstalling **or running**".
- The examples, "hosted sandboxes or other agent infrastructure", are server-side. Still, the "or running" clause has no server-only limit, and our app starts, drives and stops the process.
- Bundling the SDK's platform binary is squarely "preinstalling".
- Using the user's own copy does **not** clearly escape the clause. It only removes the "preinstalling" half.
- The safest reading: accept the Commercial Terms (a free Console account) whichever way we ship, and meet both conditions. Those conditions are an unmodified binary with no auth method removed, and each user on their own credentials.

---

## Q3. Anthropic's public statements and enforcement

Primary sources only (X posts checked through the fxtwitter API for exact text and UTC timestamps).

| Date (UTC) | Who | What | Source |
| --- | --- | --- | --- |
| 2026-01-09 | Thariq Shihipar (Anthropic, Claude Code) | "Yesterday we tightened our safeguards against spoofing the Claude Code harness after accounts were banned for triggering abuse filters from third-party harnesses using Claude subscriptions." / "Third-party harnesses using Claude subscriptions create problems for users and are prohibited by our Terms of Service. They generate unusual traffic patterns without any of the usual telemetry that the Claude Code harness provides…" / "This is why the supported way to use Claude in your own tools is via the API." / "We'll make it clearer in the OAuth screen going forward." / "We've lifted all bans we're aware of that were caused by this issue" | <https://x.com/trq212/status/2009689809875591565> ([thread](https://threadreaderapp.com/thread/2009689809875591565.html)) |
| 2026-02-18 | Thariq Shihipar | "Apologies, this was a docs clean up we rolled out that's caused some confusion. Nothing is changing about how you can use the Agent SDK and MAX subscriptions!" | <https://x.com/trq212/status/2024212378402095389> |
| 2026-02-18 | Thariq Shihipar (same thread) | "We want to encourage local development and experimentation with the Agent SDK and claude -p. If you're building a business on top of the Agent SDK, you should use an API key instead. We'll make sure that's clearer in our docs." | <https://x.com/trq212/status/2024212380142752025> |
| 2026-03-19 | OpenCode maintainer (Dax, `thdxr`) | PR "anthropic legal requests", merged: "Remove anthropic references per legal requests: Remove anthropic-20250930.txt prompt file … Remove opencode-anthropic-auth builtin plugin …" | <https://github.com/anomalyco/opencode/pull/18186> (the legal request itself isn't public) |
| 2026-04-03 | Boris Cherny (Head of Claude Code) | "Starting tomorrow at 12pm PT, Claude subscriptions will no longer cover usage on third-party tools like OpenClaw. You can still use these tools with your Claude login via extra usage bundles (now available at a discount), or with a Claude API key." | <https://x.com/bcherny/status/2040206440556826908> |
| 2026-05-13 | @ClaudeDevs (official) | "Starting June 15, paid Claude plans can claim a dedicated monthly credit for programmatic usage. The credit covers usage of: - Claude Agent SDK - claude -p - Claude Code GitHub Actions - Third-party apps built on the Agent SDK" | <https://x.com/ClaudeDevs/status/2054610152817619388> |
| 2026-05-13 | @ClaudeDevs (same thread) | "This means that third-party tools built on the Agent SDK like Conductor and OpenClaw work with your Claude plan, but will draw from your credit the same way your own scripts do." | <https://x.com/ClaudeDevs/status/2054610157364289906> |
| 2026-06-15/16 | Anthropic Help Center | Change paused: "Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits." | Help article above |

Reading the record:

1. **What got blocked or legally pressed:** harnesses that took the subscription OAuth token and called the API while pretending to be Claude Code ("spoofing the Claude Code harness"), such as OpenCode's `opencode-anthropic-auth` plugin. Unimatrix Zero doesn't do this: it runs the real binary, which does its own OAuth.
2. **The April 4 OpenClaw change was a billing change, not a ban.** Usage moved to "extra usage" but still ran "with your Claude login".
3. **On 2026-05-13 Anthropic's official developer account named an Agent SDK-based third-party GUI (Conductor) as working with Claude plans.** It said this about a billing plan that was later paused, but the pause note keeps "third-party app usage" on subscription limits. That is the closest thing to public acceptance of our architecture. It isn't an approval of any specific app.
4. **Signals still pointing the other way:**
   - The SDK "unless previously approved" note.
   - The legal page's "does not permit third-party developers to offer Claude.ai login into their own applications".
   - Thariq's "If you're building a business on top of the Agent SDK, you should use an API key instead". A free, no-revenue app is arguably not "a business", but that is an interpretation.

Per app:

| App | Primary evidence found | Status |
| --- | --- | --- |
| Conductor | Named by @ClaudeDevs, 2026-05-13, as working "with your Claude plan" | Publicly acknowledged; no "approval" statement |
| OpenClaw | Named by Boris Cherny (moved to extra usage, 2026-04-04) and by @ClaudeDevs (works with the plan) | Acknowledged; billing changed |
| OpenCode | Merged PR removing Anthropic OAuth "per legal requests" | Asked to stop (the letter itself isn't public) |
| T3 Code | Its README says it "Works with your subscriptions on Claude Code, Codex, …" and asks users to run `claude auth login` | **No Anthropic statement found.** Press reports that Theo Browne criticised the June credit plan are **[secondary]** |
| Zed | Zed docs: "authenticate with an API key or with Claude Code where supported"; "Billing, legal terms, retention, and data handling are between you and the agent provider." (<https://zed.dev/docs/ai/external-agents>) | **No Anthropic statement found** |
| Crystal, opcode (formerly Claudia) | None | **[unverified]** Any claim that they were approved, warned or renamed at Anthropic's request is unverified |

Also **[secondary]**: The Register (2026-04-06) quotes an Anthropic spokesperson: "Using Claude subscriptions with third-party tools isn't permitted under our Terms of Service". An X user reported that Anthropic sent a trademark cease-and-desist to "The Digital Whip for Claude" over branding, not authentication. Neither was verified at the source.

---

## Q4. OpenAI and the Codex path

### Terms of Use: silent on third-party clients

<https://openai.com/policies/row-terms-of-use/> and <https://openai.com/policies/terms-of-use/>, "Published: January 1, 2026 … Effective: January 1, 2026". Read from the Wayback snapshots of 2026-09-26, because openai.com returns 403.

> You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account.

Under "What you cannot do":

> Modify, copy, lease, sell or distribute any of our Services. … Automatically or programmatically extract data or Output (defined below). … Interfere with or disrupt our Services, including circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations we put on our Services.

> Software. Our Services may allow you to download software … Our software may include open source software that is governed by its own licenses that we've made available to you.

### Service Terms

<https://openai.com/policies/service-terms/>, Wayback snapshot of 2026-09-25. The only Codex section is about outputs: "4. Codex and Code Generation — Output generated by code generation features of our Services, including OpenAI Codex, may be subject to third party licenses, including, without limitation, open source licenses."

### Usage Policies

<https://openai.com/policies/usage-policies/>, "Effective: October 29, 2025", Wayback snapshot of 2026-09-26. Nothing about third-party clients. The changelog notes (2022-11-09): "We no longer require you to register your applications with OpenAI."

### Codex docs: explicitly supportive of our pattern

Fetched 2026-09-27.

- App Server (<https://learn.chatgpt.com/docs/app-server.md>): "Codex app-server is the interface Codex uses to power rich clients (for example, the Codex VS Code extension). Use it when you want a deep integration inside your own product: authentication, conversation history, approvals, and streamed agent events."
- Same page, auth modes: "**ChatGPT managed (`chatgpt`)** - Codex owns the ChatGPT OAuth flow, persists tokens, and refreshes them automatically." This is the mode we'd use; we never touch the token.
- Same page: "**Important**: Use `clientInfo.name` to identify your client for the OpenAI Compliance Logs Platform. If you are developing a new Codex integration intended for enterprise use, please contact OpenAI to get it added to a known clients list."
- Same page, **caveat**: "The app-server command and WebSocket transport are experimental and aren't supported for production workloads." This sits in the remote Code Mode host section. The stdio transport and the core methods aren't flagged that way, but some methods need `experimentalApi`.
- Codex SDK (<https://learn.chatgpt.com/docs/codex-sdk.md>): "Use the Codex app server to build custom clients that handle authentication, conversation history, approvals, and streamed agent events."
- Auth (<https://learn.chatgpt.com/docs/auth.md>): "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs. Don't expose Codex execution in untrusted or public environments." This is aimed at CI, not at interactive desktop clients.
- Codex for OSS (<https://developers.openai.com/community/codex-for-oss>): "Developers should code in the tools they prefer, whether that's Codex, OpenCode, Cline, pi, OpenClaw, or something else, and this program supports that work."

### OpenAI staff statements

Tibo Sottiaux ("Codex & ChatGPT @OpenAI"):

- 2026-01-09: "We are working with OpenCode to allow Codex users to use their Codex subscriptions and usage limits in OpenCode directly. Also exploring how to support other awesome actors in the space." <https://x.com/thsottiaux/status/2009742187484065881>
- 2026-01-16: "Pi! … it has just joined the list of open agents that supports logging in with your ChatGPT account and use the same usage you get within Codex. Who's next?" <https://x.com/thsottiaux/status/2012030806169121160>
- 2026-08-21: "Converting a subscription into api traffic to then re-serve or share across many users is not something we support and this type of usage gets flagged by our fraud-prevention systems. You are completely fine if you use your subscription through Sign in With ChatGPT, either through the official clients or through one of the many OSS clients (Pi, OpenCode, ...) that support signing in with your account and using your included usage." <https://x.com/thsottiaux/status/2090675027670978569>

**Verdict:**

- **The formal terms are silent.** Nothing in the ToU, Service Terms or Usage Policies addresses third-party clients.
- **OpenAI's docs and its Codex lead explicitly endorse third-party clients** that use Sign in with ChatGPT for the user's own usage.
- **We are not "programmatically extracting Output"** in the ToU sense. The user drives each turn through Codex, OpenAI's own agent. This is an interpretation.
- **The one explicit "don't":** re-serving or sharing one subscription across users (sub2api).

### Bundling the `codex` binary

- `openai/codex` licence: Apache-2.0 (GitHub API `spdx_id`).
- NOTICE: "OpenAI Codex / Copyright 2025 OpenAI / This project includes code derived from Ratatui, licensed under the MIT license. …"
- `@openai/codex@0.157.1`: `license = 'Apache-2.0'`, with per-platform optional dependencies.
- **No restriction beyond Apache-2.0 was found.** We must include the LICENSE and NOTICE and state any changes (we make none).
- Apache-2.0 §6 grants no trademark rights, so don't brand the app "Codex".
- The ToU line "Modify, copy, lease, sell or distribute any of our Services" doesn't override this: the ToU itself says its software "may include open source software that is governed by its own licenses".

---

## Implications for Unimatrix Zero

1. **Codex path: go ahead.** Bundle or detect `codex`, keep LICENSE and NOTICE, set `clientInfo.name` to our own name, use managed `chatgpt` login, never use `chatgptAuthTokens`, and never share one login across users.
2. **Claude path: shippable, with policy risk we can't remove on our own.** To stay inside the text that is explicitly allowed:
   - Run the **unmodified** `claude` binary and leave every auth method it offers available.
   - Let the binary do the OAuth. Never read `.credentials.json` or the Keychain.
   - One user, one own subscription. No shared or proxied use, no charging, no reselling.
   - Accept the Commercial Terms ourselves through a free Console account, since "running Claude Code in your products" plausibly covers us whether or not we bundle.
   - Follow the naming rules: no "Claude Code" or "Claude" in our product name. Plain-text statements like "runs Claude Code" are fine.
   - Tell users Anthropic says Pro and Max limits "assume ordinary, individual usage".
3. **Prefer detecting the user's own `claude` over bundling**, as T3 Code does. That drops the "preinstalling" half of the clause, and the app then clearly isn't "offering" login: the user already signed in to Claude Code. Offer bundling or installing only as an opt-in fallback.
4. **Build for change.** Anthropic reversed itself within weeks in February, April, May and June 2026. Keep an API-key mode for Claude as a first-class fallback.
5. **If certainty matters, ask.** Email Anthropic sales ("questions about permitted authentication methods"), or DM @trq212, describing a free, no-account desktop app that spawns the user's own unmodified `claude`. A written answer is the only way to get "previously approved" status.

## Unverified or open

- Whether any GUI wrapper (T3 Code, Conductor, Zed, Crystal, opcode) holds formal Anthropic "approval". None is published.
- The text of Anthropic's legal request to OpenCode.
- Whether Anthropic's OAuth consent screen now carries a ToS warning, as Thariq promised on 2026-01-09. Not checked.
- What the "updated plan" Anthropic promised on 2026-06-15 will contain. Nothing had been announced as of 2026-09-27.
- OpenAI's Help Center article "Using Codex with your ChatGPT plan" (<https://help.openai.com/en/articles/11369540>) returned 403 and wasn't read.
- Whether the Commercial Terms' Customer indemnity (K.2) could make a solo developer liable for a user's Usage Policy breach in practice. That needs a lawyer.
