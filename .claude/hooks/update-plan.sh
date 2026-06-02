#!/bin/bash
# PostToolUse hook for Claude Code — fires after every Bash tool call.
# Reads tool input JSON from stdin; outputs reminder if the command was git commit/push.

INPUT=$(cat)

if echo "$INPUT" | grep -qE 'git (commit|push)'; then
  cat "$(dirname "$0")/../../.hooks-shared/update-plan-message.txt"
fi

exit 0
