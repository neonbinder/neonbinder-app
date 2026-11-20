---
name: agent-tool-allowlists-what-the-transcripts-show
description: Facts about agent `tools:` allowlists in this repo, read from transcripts (NEO-622) — what is injected, what fails, which MCP never loads
metadata:
  type: project
---

Facts that decide any agent `tools:` / `disallowedTools` plan:

- `SubagentHandback` is always present; it never needs listing (the E2E author used it with an allowlist that omits it).
- A tool outside the allowlist fails with "No such tool available" (the E2E author's Monitor/TaskStop calls all failed), so an agent body must not tell it to use one.
- Agents with `disallowedTools: Edit, Write` (auditors, planner) cannot Write their `memory: project` notes; they write memory through Bash heredocs.
- The `playwright-test` MCP in the monorepo `.mcp.json` never loads in root-launched sessions (0 calls in 14 days), so instructions built on `browser_snapshot`/`test_run` are dead.
- No Grep/Glob tool exists in current builds (0 calls); search is Bash grep. Listing them is harmless.
- claude.ai connectors appear under two names (plugin/`claude_ai_` and a UUID form); an allowlist naming one silently drops the other.

**Why:** a wrong allowlist removes a tool an agent relies on, or keeps 60-75K of tool/skill listings in every call.
**How to apply:** count real tool use per agent type in the transcripts before proposing a list; verify after merge by spawning each agent once and checking its first-call context. See [[monitor-watches-cap-at-30-minutes]].
