# Reconnect, offline and error states: what the user likes

Feeds the resolution of the Reconnect, offline and error states ticket (#40).

**Verdict: variant A (bands across the top), as built, with the choices below.** App-wide problems are bands across the top of the canvas, worst first, each with one action. The bands overlay the canvas, so the layout never jumps. Variants B (an Input card where the problem bites, plus a sidebar footer) and C (a Connections section in the sidebar, plus toasts) stay in the code as earlier options.

1. **No offline queue.** While offline, Send is disabled and the draft is kept, with the slim note "Offline · sending waits for the connection" above the Input.
2. **Deleting works offline:** Prompts and Turns, Branches, Threads, Trees and Collections. SQLite is the source of truth and nothing syncs with the Providers, so being offline doesn't affect deleting. (An earlier pass blocked it; that was reversed.)
3. **A refused send adds nothing to the Tree.** That covers an expired sign-in, a Provider program that crashes or won't start, and a Provider outage. The Prompt stays in the Input, and a band says why and offers the fix ("Sign in again", "Download Claude again").
4. **Cut-off running Replies keep their partial text.** When the connection drops mid-Reply, the Reply shows "Connection lost · reconnecting…" for a while (the vendor program's own retries), then "Connection lost".
5. **No automatic retry of cut-off Replies, ever.** Retry is manual. It works only when the app is online and that Reply's Provider is signed in; otherwise it's disabled with a reason ("Retry when you're back online", or "Sign in to Claude to retry", which opens sign-in). A Retry that is refused keeps the partial text.
6. **"Sign in again" opens a dialog with the onboarding steps:** sign in on the Provider's page, paste the code (Claude), check the plan. Signing in with a different account just continues the existing Trees, with a note that usage now counts against that account.
7. **Re-downloading the Provider program says "Downloading Claude… N%".** The button says "Download Claude again", never "Repair". If the fresh copy still won't start, the action becomes "Report a problem…".
8. **Update failures** say the update "didn't finish downloading" or "didn't pass its safety check", say the current version keeps working, and offer Try again.
9. **Settings → Connections:**
   - Sign out and Remove <Provider>… are buttons, each with a short description underneath. Sign out: "Ends your sign-in. Claude stays set up; sign in again to pick up where you left off." Remove: "Removes Claude from this app. Your Trees stay. You can download Claude again later."
   - The word "Disconnect" is dropped; it was misleading.
   - Remove always asks first. If Replies are running, the confirmation shows a live count of them that changes as they finish.
   - Remove stops running Replies (they keep their text and say "Stopped: you removed Claude"), cancels any download in progress, and returns the card to Connect.
   - Sign out asks first only when Replies are running, with the same live count.
