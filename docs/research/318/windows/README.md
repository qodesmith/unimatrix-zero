# Windows tests for #318, question 6

You are on the Windows machine with this branch checked out. Run every test below, post the findings as a comment on #318, and only then is question 6 answered. Read #318 and its comments first: the Mac findings there say what the helper and the app's card do on macOS and Linux, and the comment named "Windows: facts from Microsoft's docs" marks what is still unconfirmed.

The goal: the app's card comes first, then the command runs with admin rights, and its output reaches the AI. Find which route does that, and write down what the user sees at each step.

## Setup

1. Run `bun install`, then ask the human to run `bun run dev` here and connect Claude and ChatGPT. Each checkout keeps its own dev data.
2. Record the machine, from a normal PowerShell window:

   ```powershell
   [Environment]::OSVersion.Version; (Get-ComputerInfo).OsDisplayVersion
   whoami /groups | findstr /i "S-1-16 S-1-5-32-544"
   Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System |
     Select-Object EnableLUA, ConsentPromptBehaviorAdmin, ConsentPromptBehaviorUser, PromptOnSecureDesktop, TypeOfAdminApprovalMode
   sudo config
   ```

   `S-1-5-32-544` listed means the account is an administrator. `TypeOfAdminApprovalMode` of 2 means administrator protection is on. Ask the human whether a standard (non-admin) account exists for test 6.

3. The scripts are in this folder. Write its absolute path wherever a step says `<here>`.

The app has two Permission modes to test with: Full access (`bun run dev`) and Supervised (`bun run dev --supervised`). Under Supervised, ChatGPT's commands run inside the Sandbox where the Windows build allows it, and Claude has no Sandbox on Windows (ADR 0018).

## What to record for every test

Ask the human to watch the screen and tell you, since UAC's prompt is on a desktop no tool can see or screenshot:

- each thing that appeared, in order: a console window flash, the stand-in card, the UAC prompt
- the UAC prompt's wording: the program name, the publisher, and what "Show more details" lists as the command line
- whether it asked Yes/No or for a password, PIN or Windows Hello
- the command's output and exit code as the Reply shows them
- seconds from sending the Prompt to the output

Send each command to the AI in a Prompt of this shape, once per Provider: "This is a test of this app. Run this as one shell command, exactly as written, wait up to 3 minutes for it, then show its raw output and exit code. Don't try alternatives or fixes."

## Tests

Run each on Claude and on ChatGPT. Run tests 1 to 4 under Full access first, then again under Supervised.

1. **Baseline.** `net session`. Record the error an admin command gives without admin rights.
2. **Route A, the AI's command asks UAC itself.** `powershell -NoProfile -ExecutionPolicy Bypass -File <here>\elevate.ps1 -Command "net session; whoami /groups | findstr S-1-16"`
   - With the human clicking **Yes**: does the output come back, and does it show `S-1-16-12288` (High)?
   - With the human clicking **No**: record the line `elevate.ps1` prints.
   - With the human doing nothing: record how long UAC waits and what comes back.
   - Under Supervised on ChatGPT: does the Sandbox let the UAC prompt appear at all?
3. **Route B, the card first.** The human starts `broker.ps1` in a normal PowerShell window, as its header says. Then: `powershell -NoProfile -ExecutionPolicy Bypass -File <here>\ask.ps1 -Command "net session"`
   - Yes on the card, then Yes on UAC: the order of what appeared, and the output.
   - No on the card: no UAC prompt should appear.
   - Yes on the card, then No on UAC.
   - Under Supervised on ChatGPT: can `ask.ps1` reach the broker's pipe from inside the Sandbox?
4. **Two at once.** With the broker running: `Start-Job { powershell -File <here>\ask.ps1 -Command "whoami" }; powershell -File <here>\ask.ps1 -Command "hostname"`. The broker answers one request at a time; record how the cards and UAC prompts queue. Then the same with `elevate.ps1` in both places: do two UAC prompts stack, and can the human tell which command each one is for?
5. **Windows sudo** (Windows 11 24H2 or later; Full access is enough).
   - Off: `sudo net session`. Record the message and exit code.
   - The human turns it on from an elevated PowerShell: `sudo config --enable normal` (inline mode). Then `sudo net session` twice in a row from the AI: does output come back with no console attached, what is the exit code, and does UAC ask both times?
   - The same with `sudo config --enable disableInput` and `sudo config --enable forceNewWindow`.
   - Record what UAC names as the program for each.
   - When done, the human puts sudo back the way it was.
6. **Standard account**, if one exists. Sign in as it, connect a Provider, and repeat tests 2 and 5. Record the credential prompt: which accounts it offers, and that the command then runs as that admin (`whoami` in the command shows who).
7. **Administrator protection**, if the machine has it (KB5120998). Turn it on, restart, and repeat test 2. Record the Windows Hello prompt, and whether `elevate.ps1` still gets its output file: the elevated command runs as a separate hidden account, so `whoami` and `$env:TEMP` differ.

A script that fails for a reason of its own, not Windows', gets fixed and committed to this branch; say what changed in the findings.

## Findings

Post one comment on #318 titled "Windows findings (question 6)". It holds the machine record from Setup, a table of test, Provider, mode, what the user saw and the result, and then the answer: which route puts the app's card first and returns the output, and what the user sees at each step. Tests you couldn't run are listed with the reason.
