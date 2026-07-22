#!/usr/bin/env bash
set -u

# WorktreeCreate replaces Claude Code's own git operation. Keep stdout reserved
# for the one path Claude Code consumes, and fail open to a usable directory.
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

safe_slug() {
  local value safe
  value="$1"
  safe=$(printf '%s' "$value" | sed 's/[^A-Za-z0-9._-]/-/g; s/^[.-]*//; s/[.-]*$//')
  if [ -z "$safe" ]; then
    safe="claude-worktree-$$"
  fi
  printf '%s' "$safe"
}

pando_is_compatible() {
  local version_output major minor
  command -v pando >/dev/null 2>&1 || return 1
  version_output=$(pando --version 2>/dev/null) || return 1

  # Lifecycle flags first shipped with pando 0.1.0. Development builds do not
  # always print semver, so let the non-interactive add call probe those builds.
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

is_worktree_directory() {
  local top
  [ -d "$target_dir" ] || return 1
  top=$(git -C "$target_dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$top" = "$target_dir" ]
}

canonicalize_directory() {
  local candidate base canonical
  candidate="$1"
  [ -n "$candidate" ] || return 1

  case "$candidate" in
    /*) ;;
    *)
      base=$(pwd -P 2>/dev/null) || return 1
      candidate="$base/$candidate"
      ;;
  esac

  [ -d "$candidate" ] || return 1
  canonical=$(cd "$candidate" 2>/dev/null && pwd -P) || return 1
  case "$canonical" in
    /*) ;;
    *) return 1 ;;
  esac
  [ -d "$canonical" ] || return 1
  printf '%s' "$canonical"
}

absolute_tmp_directory() {
  local candidate attempt

  candidate=$(mktemp -d "/tmp/pando-worktree.XXXXXX" 2>/dev/null || printf '')
  if [ -d "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi

  # Retain the path contract even if mktemp itself is unavailable or fails.
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    candidate="/tmp/pando-worktree.$$.$RANDOM.$attempt"
    if mkdir -m 700 "$candidate" 2>/dev/null; then
      printf '%s' "$candidate"
      return 0
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

fallback_to_git() {
  local output_path tmp_base canonical_path
  diagnose "using git worktree fallback for '$name'"
  mkdir -p "$(dirname "$target_dir")" 2>/dev/null || true

  # A failed pando response can still leave a complete worktree behind.
  if ! is_worktree_directory; then
    rmdir "$target_dir" 2>/dev/null || true
    if ! git -C "$repo_root" worktree add -b "$branch" "$target_dir" >&2; then
      diagnose "could not create branch '$branch'; trying an existing branch"
      if ! git -C "$repo_root" worktree add "$target_dir" "$branch" >&2; then
        diagnose "git worktree fallback failed; preserving a directory for Claude Code"
      fi
    fi
  fi

  output_path="$target_dir"
  if [ ! -d "$output_path" ]; then
    mkdir -p "$output_path" 2>/dev/null || true
  fi
  if [ ! -d "$output_path" ]; then
    tmp_base="/tmp"
    case "${TMPDIR:-}" in
      /*) tmp_base="$TMPDIR" ;;
    esac
    output_path=$(mktemp -d "${tmp_base%/}/pando-${safe_name}.XXXXXX" 2>/dev/null || printf '')
  fi

  canonical_path=$(canonicalize_directory "$output_path" 2>/dev/null || printf '')
  if [ -z "$canonical_path" ]; then
    output_path=$(absolute_tmp_directory 2>/dev/null || printf '')
    canonical_path=$(canonicalize_directory "$output_path" 2>/dev/null || printf '')
  fi

  # Creation can only fail when the environment offers no writable location.
  # Never compound that failure by emitting a relative or nonexistent path.
  if [ -z "$canonical_path" ]; then
    canonical_path=$(canonicalize_directory /tmp 2>/dev/null \
      || canonicalize_directory "$base_cwd" 2>/dev/null \
      || canonicalize_directory / 2>/dev/null)
  fi

  printf '%s\n' "$canonical_path"
}

hook_input=$(cat 2>/dev/null || printf '{}')
name=""
session_id=""
input_cwd=""
json_ready=false

if command -v jq >/dev/null 2>&1; then
  name=$(printf '%s' "$hook_input" | jq -er '.name | select(type == "string" and length > 0)' 2>/dev/null || printf '')
  session_id=$(printf '%s' "$hook_input" | jq -er '.session_id | select(type == "string" and length > 0)' 2>/dev/null || printf '')
  input_cwd=$(printf '%s' "$hook_input" | jq -er '.cwd | select(type == "string" and length > 0)' 2>/dev/null || printf '')
  if [ -n "$name" ] && [ -n "$session_id" ] && [ -n "$input_cwd" ]; then
    json_ready=true
  else
    diagnose "invalid WorktreeCreate input; delegating to git"
  fi
else
  # The fallback parser only needs the contract's slug and ordinary path fields;
  # pando output itself is never parsed without jq.
  name=$(simple_json_string name)
  session_id=$(simple_json_string session_id)
  input_cwd=$(simple_json_string cwd)
  diagnose "jq is unavailable; delegating worktree creation to git"
fi

safe_name=$(safe_slug "${name:-worktree}")
name="${name:-$safe_name}"
branch="$safe_name"

base_cwd="$input_cwd"
if [ -z "$base_cwd" ] || [ ! -d "$base_cwd" ]; then
  base_cwd=$(pwd -P)
else
  base_cwd=$(cd "$base_cwd" 2>/dev/null && pwd -P || pwd -P)
fi

repo_root=$(git -C "$base_cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$base_cwd")
case "$repo_root" in
  /*) ;;
  *) repo_root="$base_cwd/$repo_root" ;;
esac
target_dir="$repo_root/.claude/worktrees/$safe_name"

if is_falsey "${CLAUDE_PLUGIN_OPTION_DELEGATECREATION:-true}"; then
  diagnose "pando delegation is disabled"
  fallback_to_git
  exit 0
fi

if [ "$json_ready" != true ]; then
  fallback_to_git
  exit 0
fi

if ! pando_is_compatible; then
  diagnose "pando 0.1.0 or newer is unavailable"
  fallback_to_git
  exit 0
fi

pando_output=""
if pando_output=$(pando add "$branch" --path "$target_dir" --ephemeral --owner "$session_id" --json); then
  created_path=$(printf '%s' "$pando_output" | jq -er '
    if (.success // true) == true then
      (.worktree.path // .path // .worktreePath)
    else
      empty
    end
    | select(type == "string" and length > 0)
  ' 2>/dev/null || printf '')

  if [ -n "$created_path" ]; then
    case "$created_path" in
      /*) ;;
      *) created_path="$repo_root/$created_path" ;;
    esac
    printf '%s\n' "$created_path"
    exit 0
  fi
  diagnose "pando returned JSON without a worktree path"
else
  diagnose "pando add failed"
fi

fallback_to_git
exit 0
