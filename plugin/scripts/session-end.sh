#!/usr/bin/env bash
set -u

# SessionEnd is advisory and time-bounded. Never let cleanup failures interfere
# with Claude Code shutdown, and keep command stdout out of the hook response.
diagnose() {
  printf 'pando plugin: %s\n' "$*" >&2
}

is_falsey() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    false | 0 | no) return 0 ;;
    *) return 1 ;;
  esac
}

simple_json_string() {
  local key="$1"
  printf '%s' "$hook_input" \
    | tr '\n' ' ' \
    | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

pando_is_compatible() {
  local version_output major minor
  command -v pando >/dev/null 2>&1 || return 1
  version_output=$(pando --version 2>/dev/null) || return 1
  if [[ ! "$version_output" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    return 0
  fi

  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  if ((major > 0 || minor >= 1)); then
    return 0
  fi
  return 1
}

hook_input=$(cat 2>/dev/null || printf '{}')

if is_falsey "${CLAUDE_PLUGIN_OPTION_REAPONSESSIONEND:-true}"; then
  exit 0
fi

has_jq=false
if command -v jq >/dev/null 2>&1; then
  has_jq=true
  session_id=$(printf '%s' "$hook_input" | jq -er '.session_id | select(type == "string" and length > 0)' 2>/dev/null || printf '')
else
  session_id=$(simple_json_string session_id)
  diagnose "jq is unavailable; skipping owner lock discovery"
fi

if [ -z "$session_id" ]; then
  diagnose "SessionEnd input has no session_id; skipping cleanup"
  exit 0
fi

if ! pando_is_compatible; then
  diagnose "pando 0.1.0 or newer is unavailable; skipping cleanup"
  exit 0
fi

if [ "$has_jq" = true ]; then
  list_output=""
  if list_output=$(pando list --json); then
    owned_paths=$(printf '%s' "$list_output" | jq -r --arg owner "$session_id" '
      .worktrees[]?
      | select(.owner == $owner and .locked == true)
      | .path
      | select(type == "string" and length > 0)
    ' 2>/dev/null || printf '')

    if [ -n "$owned_paths" ]; then
      while IFS= read -r worktree_path; do
        [ -n "$worktree_path" ] || continue
        if ! pando unlock "$worktree_path" --json >/dev/null; then
          diagnose "could not unlock '$worktree_path'"
        fi
      done <<<"$owned_paths"
    fi
  else
    diagnose "could not list worktrees for session cleanup"
  fi
fi

if ! pando reap --owner "$session_id" --force --json >/dev/null; then
  diagnose "owner-scoped reaping failed for session '$session_id'"
fi

exit 0
