#!/usr/bin/env bash
# Proves a diff touched comments and whitespace only.
#
# Minifies every changed file at the base ref and in the working tree, then
# compares. Minification discards comments, so identical output means the code
# is unchanged. Files whose minified output differs are printed and the script
# exits non-zero.
#
# Minification also discards directives (oxlint-disable, @ts-expect-error,
# "use no memo"), so this check cannot see a deleted one. Audit those separately
# with git grep counts against the base ref.
#
# Usage: verify-comments-only.sh [base-ref]   (default: HEAD)

set -uo pipefail

base="${1:-HEAD}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The lockfile names the project's package runner. Without one, Bun wins when
# it is installed. bunx has no --yes; it fetches a missing package by default.
root="$(git rev-parse --show-toplevel)"
if [ -f "$root/bun.lock" ] || [ -f "$root/bun.lockb" ]; then
  run=(bunx)
elif [ -f "$root/pnpm-lock.yaml" ]; then
  run=(pnpm dlx)
elif [ -f "$root/package-lock.json" ] || [ -f "$root/npm-shrinkwrap.json" ]; then
  run=(npx --yes)
elif command -v bunx > /dev/null 2>&1; then
  run=(bunx)
else
  run=(npx --yes)
fi

checked=0
differs=0
skipped=()
unverifiable=()

while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue

  case "$file" in
    *.ts | *.tsx | *.mts | *.cts) ext="${file##*.}" ;;
    *.js | *.jsx | *.mjs | *.cjs) ext="${file##*.}" ;;
    *.css) ext="css" ;;
    *) skipped+=("$file"); continue ;;
  esac

  git show "$base:$file" > "$tmp/old.$ext" 2> /dev/null || continue
  cp "$file" "$tmp/new.$ext"

  # esbuild infers the loader from the extension; passing --loader with a file
  # input is an error, which would leave both sides empty and equal.
  # Only stdout is compared: a cold runner cache prints an install notice on
  # stderr for the first call alone, which would read as a code change.
  if ! old="$("${run[@]}" esbuild "$tmp/old.$ext" --minify-whitespace --minify-syntax 2> "$tmp/err")"; then
    echo "MINIFY FAILED (base): $file"
    head -3 "$tmp/err"
    differs=$((differs + 1))
    continue
  fi
  if ! new="$("${run[@]}" esbuild "$tmp/new.$ext" --minify-whitespace --minify-syntax 2> "$tmp/err")"; then
    echo "MINIFY FAILED (worktree): $file"
    head -3 "$tmp/err"
    differs=$((differs + 1))
    continue
  fi
  # Type-only files erase to nothing, so there is no code left to compare.
  if [ -z "$old" ] && [ -z "$new" ]; then
    unverifiable+=("$file")
    continue
  fi

  checked=$((checked + 1))
  if [ "$old" != "$new" ]; then
    echo "CODE CHANGED: $file"
    differs=$((differs + 1))
  fi

  rm -f "$tmp/old.$ext" "$tmp/new.$ext"
done < <(git diff --name-only "$base")

echo "checked $checked file(s) against $base; $differs with code changes"

if [ ${#unverifiable[@]} -gt 0 ]; then
  echo "type-only, nothing left after erasure - review by hand: ${unverifiable[*]}"
fi

if [ ${#skipped[@]} -gt 0 ]; then
  echo "not machine-checkable, review by hand: ${skipped[*]}"
fi

[ "$differs" -eq 0 ]
