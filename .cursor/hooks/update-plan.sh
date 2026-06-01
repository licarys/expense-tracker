#!/bin/bash
# Triggered after any `git commit` or `git push` run by the agent.
# Injects a reminder to keep PROJECT.md in sync with the latest changes.
cat > /dev/null  # drain stdin

echo '{
  "agent_message": "A git commit or push was just made. Review PROJECT.md and update it if needed: mark completed roadmap items, add new features or bug fixes to the Features section, update Known issues, and refresh the Cursor prompt block if the architecture changed. Only update if something actually changed — do not make trivial edits."
}'
exit 0
