#!/bin/bash
# Runs after the agent writes a JS file.
# Performs: syntax check (node --check) + common bug pattern scan.
# Returns additional_context when issues are found so the agent can fix them.

set -euo pipefail

input=$(cat)

# Extract the file path written by the Write tool
file=$(echo "$input" | python3 -c "
import json, sys
d = json.load(sys.stdin)
p = d.get('tool_input', {}).get('path', '') or d.get('input', {}).get('path', '')
print(p)
" 2>/dev/null || echo "")

# Only act on project JS files
if [[ -z "$file" ]] || [[ ! "$file" =~ js/[^/]+\.js$ ]] || [[ ! -f "$file" ]]; then
  echo '{}'
  exit 0
fi

issues=()

# ── 1. Syntax check ──────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  syntax_out=$(node --check "$file" 2>&1) || true
  if [[ -n "$syntax_out" ]]; then
    issues+=("SYNTAX ERROR in $file:\n$syntax_out")
  fi
fi

# ── 2. Pattern scan ──────────────────────────────────────────────────────────
patterns=(
  "console\\.log"         # debug logs left behind
  "debugger"              # debugger breakpoints
  "TODO\|FIXME\|HACK"     # unresolved markers
  "== null\b\|== undefined\b"   # loose null checks (prefer === or ??)
  "\beval\b"              # dangerous eval
  "localStorage\." # side effects in utils.js (pure functions only)
)
labels=(
  "console.log left behind"
  "debugger statement left behind"
  "TODO/FIXME/HACK marker"
  "loose null/undefined comparison (use === or ??)"
  "eval() usage (dangerous)"
  "localStorage in utils.js (should be pure — no side effects)"
)

# utils.js must be pure — flag localStorage only there
is_utils=false
[[ "$file" == *"utils.js" ]] && is_utils=true

for i in "${!patterns[@]}"; do
  pat="${patterns[$i]}"
  label="${labels[$i]}"

  # Skip localStorage check for app.js (DOM file — side effects allowed)
  if [[ "$label" == *"localStorage"* ]] && [[ "$is_utils" == false ]]; then
    continue
  fi

  matches=$(grep -n "$pat" "$file" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    issues+=("⚠ $label:\n$matches")
  fi
done

# ── 3. Missing return guard check (utils.js only) ────────────────────────────
if [[ "$is_utils" == true ]]; then
  # Functions that accept inputs but have no return statement
  no_return=$(grep -n "^function " "$file" | while IFS= read -r line; do
    lineno=$(echo "$line" | cut -d: -f1)
    fname=$(echo "$line" | grep -o 'function [a-zA-Z_]*' | head -1)
    # Check if next 20 lines contain 'return'
    tail_n=$(tail -n +"$lineno" "$file" | head -30)
    if ! echo "$tail_n" | grep -q '\breturn\b'; then
      echo "  line $lineno: $fname (no return statement found in first 30 lines)"
    fi
  done)
  if [[ -n "$no_return" ]]; then
    issues+=("ℹ Functions with no visible return in utils.js:\n$no_return")
  fi
fi

# ── 4. Build output ──────────────────────────────────────────────────────────
if [[ ${#issues[@]} -eq 0 ]]; then
  echo '{}'
  exit 0
fi

# Join issues into a readable block
report="Bug scan for $file found ${#issues[@]} issue(s):\n\n"
for issue in "${issues[@]}"; do
  report+="---\n$issue\n\n"
done
report+="Please review and fix before continuing."

# Escape for JSON
json_report=$(echo -e "$report" | python3 -c "
import json, sys
print(json.dumps(sys.stdin.read()))
")

echo "{\"additional_context\": $json_report}"
exit 0
