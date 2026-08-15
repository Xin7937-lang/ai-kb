# 04 — Settings toggle + audit history UI

**What to build:** The user can flip the `agent_tools_enabled` toggle on the settings page, and browse a list of recent agent actions with timestamps, action types, targets, and results.

**Blocked by:** 01 (toggle key + audit table must exist)

**Status:** ready-for-agent

- [ ] Settings page renders a toggle component for `agent_tools_enabled` that reads the current setting on load and writes on change (uses the existing settings KV pattern)
- [ ] Toggle state is reflected correctly: toggling OFF disables tool mounting on the next chat request; toggling ON enables it
- [ ] New GET endpoint lists `agent_actions` rows, paginated (default page size chosen at implementation), with optional filter by conversation ID; response shape matches the existing API conventions (`{ data: [...] }` or `{ error, message }`)
- [ ] Settings page renders an audit history section: timestamp, action type, target note ID, result, error message
- [ ] Empty state is shown when no actions exist (no audit rows yet)
- [ ] The audit list supports filtering by conversation ID via a query parameter
- [ ] Visual smoke: with toggle OFF, no tools mount in chat; toggle ON, tools mount; perform an action; the new row appears in the audit list with correct fields
- [ ] No regression: existing settings (chat retrieve limit, chat web search, search providers, app title, password) continue to work as before