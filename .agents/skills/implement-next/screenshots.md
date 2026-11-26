# Screenshots

How `implement-next` captures the shots a PR's **Try it** section calls for (steps 6 and 8), and puts them in the PR (step 9). The `pr` skill decides which shots a PR gets; this file covers how.

## Capture

1. **Start the app** from the worktree as a background task: `bun run dev --fake`, or `bun run dev` on a `needs-provider` ticket, whose Provider the human connected in this worktree. The startup line names the port: `CDP on :<port>`.
2. **Connect** in a session named after the ticket, so tickets running side by side keep apart: `agent-browser --session <n> connect <port>`. `agent-browser --session <n> get url` prints `app-dev://unimatrix-zero/` once you're on the app's window.
3. **Get past Connect.** A new worktree's dev data is empty, so the app opens on "Connect the AI you already pay for". Under `--fake`, click **Connect Claude**: the fake sign-in finishes in about three seconds. Then click **Start chatting →**.
4. **Follow the Try it steps** with `snapshot -i` and the refs it prints. Before each shot, `wait` for an element the shot must show.
5. **Capture the part that changed** by its ref, into a folder made with `mkdir -p node_modules/.cache/uz-shots/<n>`: `agent-browser --session <n> screenshot @e4 node_modules/.cache/uz-shots/<n>/after.png`, or `before.png`. Leave out the ref only when the change spans the window. Git ignores `node_modules`, and Chrome's `file_upload` accepts paths under the worktree.
6. **Stop the app** by stopping its background task. `agent-browser close` only ends the session and leaves the app running.

## Upload

GitHub has no API for images in a PR body. The comment box on the PR's page uploads them, and it has no file input until clicked, while a click opens the native file picker. So the file goes in through an input you add, and reaches the box as a paste.

1. Open the PR in a new Chrome tab.
2. Add a file input with `javascript_tool`:

   ```js
   const input = document.createElement('input')
   input.type = 'file'
   input.setAttribute('aria-label', 'screenshot upload')
   document.body.append(input)
   ```

3. `find` "file input labeled screenshot upload" for its ref, and `file_upload` one shot to it.
4. Paste it into the comment box, and wait for the tag GitHub writes:

   ```js
   const file = document.querySelector('input[aria-label="screenshot upload"]').files[0]
   const box = document.querySelector('form[aria-label="Add comment form"] textarea')
   const before = (box.value.match(/user-attachments\/assets/g) ?? []).length
   const data = new DataTransfer()
   data.items.add(file)
   box.focus()
   box.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
   for (let i = 0; i < 60 && (box.value.match(/user-attachments\/assets/g) ?? []).length === before; i++) {
     await new Promise(resolve => setTimeout(resolve, 500))
   }
   box.value
   ```

   Each paste appends a tag such as `<img width="2560" height="1640" alt="after" src="https://github.com/user-attachments/assets/…" />`. Repeat steps 3 and 4 for each shot.
5. **Clear the box** so nothing posts: click it, press `cmd+a` then `Delete`. Remove the input, then close the tab.
6. **Fill the body.** Take each tag, delete its `width` and `height`, set `alt` to `Before` or `After`, and place it in the body's Screenshots section as the `pr` skill lays out. Write the body with `gh pr edit <pr> --body-file <file>`.

To check the result, load the PR's page. The bare asset link answers 404 to anyone logged out; the page serves the image through a signed link that works for everyone.

When Chrome isn't connected or a step here fails, the PR keeps its Try it steps, leaves out Screenshots, and says in one line under Try it why the shots are missing.
