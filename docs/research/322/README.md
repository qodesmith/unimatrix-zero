# Linux tests for #322

You are in the Ubuntu VM with branch `322-admin-commands-research` checked out. Run every test below on both Providers and post the findings as comments on #322. Read #322 first, then #318's comments "Mac and Linux findings (1/2)" and "Question 3, run live on the Mac": they hold the macOS answers your findings are compared against. ADR 0018 says what the Sandbox denies and what a let-out command keeps.

No app code changes. A script in `docs/research/318/` that fails for a reason of its own gets fixed, committed and pushed to this branch; say what changed in the findings.

## The human's part

Three things need the human, so stop and ask at each:

1. **Making the VM** (done before this session starts): Ubuntu 24.04 desktop, ARM, in UTM, signed in to the desktop as a user who can `sudo` with a password.
2. **Connecting Claude and ChatGPT** in this checkout's dev app. Each checkout keeps its own dev data.
3. **Typing the real password** into the test dialog, each time a test says so. Tell them before each one that a dialog is coming and what it is for.

## Setup

1. Install what the rig needs and check each is there: `sudo apt install -y git python3 zenity netcat-openbsd`, then `command -v nc zenity python3`. `nc` must be the OpenBSD one (`nc -h 2>&1 | head -1`), since the helper uses `nc -U`.
2. Run `bun install`.
3. Record the machine:

   ```sh
   . /etc/os-release && echo "$PRETTY_NAME"; uname -m; uname -r
   sudo -V | head -1
   echo "$XDG_SESSION_TYPE"; echo "$SHELL"; readlink -f /bin/sh
   sudo -l | grep -i -E "timestamp|env_|secure_path"
   sysctl kernel.apparmor_restrict_unprivileged_userns
   ```

   The `claude` and Codex versions are the ones the dev app runs: read them from the app, or from the vendor programs in the dev data folder that the dev app's startup line names.

4. Write the absolute path of `docs/research/318` wherever a step says `<rig>`.
5. **Start the broker** in a terminal on the desktop, outside any Sandbox, so its dialog can show: `python3 <rig>/broker.py`. It listens on `/tmp/uz318/broker.sock` and `127.0.0.1:47318`, and logs to `/tmp/uz318/broker.log`. The helper logs to `/tmp/uz318/helper.log`.
6. **Pick the broker's answer** with `echo <mode> > /tmp/uz318/mode`: `wrong` (the default) sends a wrong password, so no real one is needed; `deny` is a Deny; `dialog` asks the human for the real password.
7. **Start the dev app** as a background task, with the helper and a test variable in its environment:

   ```sh
   SUDO_ASKPASS=<rig>/askpass.sh UZ318_TOKEN=uz322 bun run dev
   ```

   Add `--supervised` for the Supervised runs. Drive it with the `agent-browser` skill: connect to the CDP port the startup line names, as `.claude/skills/implement-next/screenshots.md` shows. Then ask the human to connect both Providers.

Send each command in a Prompt of this shape, once per Provider: "This is a test of this app. Run this as one shell command, exactly as written, wait up to 3 minutes for it, then show its raw output and exit code. Don't try alternatives or fixes."

After each test, read the new lines of `helper.log` and `broker.log`. A helper line holds the `sudo` call (`parent=`), the parent of that `sudo` (`grandparent=`), the session ids (`sessions=`), and the variables the helper saw (`token=`, `thread=`, `call=`, `claude_session=`, `env=`).

## Tests

### 1. Does it run at all?

Does `bun run dev` open the app's window? Does each Provider connect, and does a Reply to "Run `uname -a`" come back? Where one fails, record the exact error and the step it failed at, and stop on that Provider.

### 2. Full access

`bun run dev`, broker mode `wrong`.

1. `echo "$SUDO_ASKPASS $UZ318_TOKEN"`: do both variables reach the command?
2. `sudo whoami`: record the error with no `-A`.
3. `sudo -A whoami`: is the helper called, and over which channel does the broker answer? With `wrong`, expect three helper calls and `sudo: 3 incorrect password attempts`.
4. The same with mode `deny`: expect one call and `sudo: no password was provided`.

### 3. sudo remembering the password

Full access, broker mode `dialog`. Each line is its own command, sent one after the other with no wait between:

1. `sudo -A whoami`. The human types the real password. Expect `root`.
2. `sudo -n true; echo "exit $?"`. Exit 0 means the password was remembered.
3. `sudo -n true`, as the whole command. A shell given one command may replace itself with it, which changes the parent of `sudo`.
4. `sudo -A id -u`. Does the dialog come up again?
5. `sudo -A whoami && sudo -n id -u`. Inside one command, does the second `sudo` run with no ask?
6. `sudo -K`, then `sudo -A whoami && sudo -K`, then `sudo -A id -u`: does the last one ask?

For each `sudo -A`, the helper's log gives the parent of `sudo`. For the `sudo -n` lines, run `ps -o pid=,ppid=,sess=,tty=,args= -p $$ -p $PPID` as its own command before and after, and record what it prints: the shell commands run from, its parent and its session. Say for each `sudo` whether it shared a parent and a session with the one that was allowed, since on Linux in #318 a `sudo` with the same parent skipped the ask.

When done, run `sudo -K` and set the mode back to `wrong`.

### 4. The Sandbox, under Supervised

`bun run dev --supervised`, broker mode `wrong`. First record whether the Sandbox is on: does the app show its "Sandbox unavailable" notice, and does `touch ~/uz322-outside` from a Reply fail? On ChatGPT, ADR 0018 says Supervised on Linux has no permission profile until #93, so record what holds today.

Answer the app's card for each command with Allow when one comes up, and record what the card says. Keep each command inside the Sandbox here: where a card offers to let the command out, that is test 5.

1. `sudo -A whoami`: does `sudo` start? Record the exact error and exit code.
2. `sh <rig>/askpass.sh test`: run by hand, can the helper reach the broker over the Unix socket or TCP, and can it write `/tmp/uz318/helper.log`? Its stderr says which.
3. `ls -la /tmp/uz318; cat /proc/self/status | grep -i -E "NoNewPrivs|Seccomp"`: is `/tmp` the real one inside, and which limits are set?

### 5. A command let out of the Sandbox

Supervised, broker mode `wrong`, then `dialog` for one run with the real password on each Provider where `sudo` starts.

1. Get `sudo -A whoami` let out of the Sandbox. Record how the card came up (by itself, or after the command failed inside), the card's exact words, and its buttons.
2. After Allow: does `sudo -A` run, is the helper called, and does the broker answer? Record the error where it is refused.
3. `sh <rig>/askpass.sh test`, let out the same way: does the helper reach the broker?

On macOS this works on Claude and is refused on ChatGPT.

### 6. Many commands at once

Full access, broker mode `wrong`.

1. `sudo -A whoami`, and read the helper's line: is `parent=` the `sudo` call word for word? Which of `token=`, `thread=`, `call=` and `claude_session=` are set? What are `grandparent=` and `great=`?
2. `sudo -A true & sudo -A id -g & wait`: do the two helper calls take turns, and what tells them apart in the log?
3. Two Trees at once, one command each, started as close together as you can: `sudo -A whoami` in one and `sudo -A id -u` in the other, once with both on one Provider and once across the two. What in each helper line names its Tree and its command? #318 didn't run this.

## Findings

Post the findings as comments on #322, the first titled "Linux findings". They hold:

- the machine record from Setup, with the `claude` and Codex versions
- for each of the six questions, a table with a column per Provider, then the answer in plain words
- what differs from the macOS answers in #318, question by question
- the exact errors and each card's words
- script fixes made on the branch
- what wasn't tested: x64, other distros, fingerprint and other login setups, and any test you couldn't run, with the reason

Leave the issue open and open no PR: the session on the Mac does both once the findings are posted.
