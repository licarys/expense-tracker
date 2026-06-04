---
name: ai-tooling-architect
description: >-
  Expert in agentic primitives across Claude, Codex, and Cursor. Analyzes user
  goals and selects the right tool: skill, hook, automation, rule, subagent, or
  MCP. Model-agnostic — recommendations translate across ecosystems. Use when
  the user says "automate X", "build something that does Y", "should I use a
  hook or a skill?", "make the agent always do Z", "what's the best way to set
  this up?", or needs architectural guidance on agentic tooling without knowing
  which primitive to use. Also use when the user asks to build a workflow,
  agent, or integration from scratch.
---

# AI Tooling Architect

Given a user goal, determine the right agentic primitive and build it. Covers Claude, Codex, and Cursor. Stays model-agnostic.

## Step 1 — Classify the request

Work through these layers in order. Stop at the first match.

| Layer | Question | Primitive |
|-------|----------|-----------|
| 1 | Does it need to shape every agent session with persistent context or standards? | **Rule** |
| 2 | Is it a reusable, on-demand workflow or domain capability? | **Skill** |
| 3 | Does it react to specific agent events (tool call, file edit, shell command)? | **Hook** |
| 4 | Is it triggered by a schedule, external event (PR, Slack, PagerDuty), or webhook? | **Automation** |
| 5 | Does it need to spawn parallel or isolated agent work? | **Subagent / Task** |
| 6 | Does it connect the agent to an external API, DB, or service? | **MCP Server** |

When a request spans multiple layers, combine primitives: e.g., a Rule that enforces calling a Skill, or a Hook that triggers a Subagent.

## Step 2 — Confirm if ambiguous

If the classification isn't obvious from context, ask one focused question using AskQuestion. Offer the 2–3 most likely primitives as options plus "Help me decide".

## Step 3 — Build it

Read and follow the corresponding skill:

| Primitive | Skill to invoke |
|-----------|----------------|
| Skill | `~/.cursor/skills-cursor/create-skill/SKILL.md` |
| Hook | `~/.cursor/skills-cursor/create-hook/SKILL.md` |
| Automation | `~/.cursor/skills-cursor/automate/SKILL.md` |
| Rule | `~/.cursor/skills-cursor/create-rule/SKILL.md` |
| Subagent | Use Cursor's `Task` tool directly; advise on subagent type |
| MCP | Guide the user to the MCP docs or scaffold a server stub |

For Subagent and MCP, build what you can directly and document what the user must finish.

## Step 4 — Add model-agnostic notes

After building, briefly document the equivalent in other ecosystems (only if relevant and different):

| Cursor | Claude | Codex / OpenAI |
|--------|--------|---------------|
| Skill (SKILL.md) | Custom instructions / system prompt | GPT instructions / Assistant prompt |
| Rule (.cursor/rules/) | CLAUDE.md / project instructions | System prompt / memory |
| Hook (hooks.json) | Tool-use with blocking logic | Function calling with validation |
| Automation | Scheduled agent / workflow | Actions + scheduled runs |
| Subagent (Task tool) | Subagent / computer_use | Codex agent / Assistant thread |
| MCP Server | MCP (supported natively) | Tool definition / OpenAI plugin |

Skip this section when the user is clearly working only in one ecosystem.

## Quick classifier cheat sheet

- **"Always do X"** → Rule (persistent) or Skill (on-demand)
- **"When the agent edits a file, run Y"** → Hook (`afterFileEdit`)
- **"Block dangerous shell commands"** → Hook (`beforeShellExecution`, `failClosed: true`)
- **"Every Monday, summarize PRs"** → Automation (cron + gitPr)
- **"When a PR opens, review it"** → Automation (git PR trigger)
- **"Run this in parallel / in isolation"** → Subagent
- **"Connect to my database / API"** → MCP Server
- **"Teach the agent our commit format"** → Skill or Rule
- **"Audit everything the agent does"** → Hook (`postToolUse`)

## Principles

- **Minimal surface**: prefer the simplest primitive that solves the problem.
- **Compose, don't duplicate**: if a skill already exists, call it; don't recreate it.
- **Fail safe**: hooks that block should use `failClosed: true` and clear error messages.
- **Portable**: where possible, build artifacts that work across models and platforms.
