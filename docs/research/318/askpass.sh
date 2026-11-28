#!/bin/sh
# Test askpass helper for #318 and #322. sudo runs it and reads the password from its
# stdout. It asks the broker (broker.py), which stands in for the app, over a
# Unix socket and then over TCP, and says on stderr which one answered.
dir=${UZ318_DIR:-/tmp/uz318}
port=${UZ318_PORT:-47318}
parent=$(ps -o args= -p "$PPID" 2>&1)
grandparent_pid=$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')
grandparent=$(ps -o args= -p "$grandparent_pid" 2>&1)
great_pid=$(ps -o ppid= -p "$grandparent_pid" 2>/dev/null | tr -d ' ')
great=$(ps -o args= -p "$great_pid" 2>&1 | cut -c1-200)
sessions="sudo:$(ps -o sess= -p "$PPID" 2>/dev/null | tr -d ' ') grandparent:$(ps -o sess= -p "$grandparent_pid" 2>/dev/null | tr -d ' ')"
context="token=${UZ318_TOKEN:-none} thread=${CODEX_THREAD_ID:-none} call=${CODEX_TOOL_CALL_ID:-none} claude_session=${CLAUDE_CODE_SESSION_ID:-none} pid=$$ ppid=$PPID sessions=[$sessions] cwd=$(pwd) prompt=[$1] parent=[$parent] grandparent=$grandparent_pid:[$grandparent] great=$great_pid:[$great] env=[$(env | cut -d= -f1 | tr '\n' ' ')]"

echo "$context" >>"$dir/helper.log" 2>/dev/null && echo "uz318 helper: wrote its log file" >&2

command -v nc >/dev/null 2>&1 || echo "uz318 helper: nc is not on the PATH, so no channel can be tried" >&2

for channel in unix tcp; do
  if [ "$channel" = unix ]; then
    answer=$(printf '%s\n' "unix $context" | nc -U "$dir/broker.sock" 2>/dev/null)
  else
    answer=$(printf '%s\n' "tcp $context" | nc 127.0.0.1 "$port" 2>/dev/null)
  fi
  case $answer in
    ok:*)
      echo "uz318 helper: the broker answered over $channel" >&2
      printf '%s\n' "${answer#ok:}"
      exit 0
      ;;
    deny)
      echo "uz318 helper: the broker said Deny over $channel" >&2
      exit 1
      ;;
  esac
  echo "uz318 helper: no answer over $channel" >&2
done
exit 1
