#!/bin/bash
# Triggered after any `git commit` or `git push` run by the agent.
cat > /dev/null  # drain stdin

MSG=$(cat "$(dirname "$0")/../../.hooks-shared/update-plan-message.txt")

echo "{\"agent_message\": \"$MSG\"}"
exit 0
