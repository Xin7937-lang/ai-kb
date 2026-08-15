# Agent Tool-Calling Workstream

> 历史归档。Agent 工具调用（stage 1 + 2）已合入 `main`，本目录保留设计决策与 ticket 跟踪记录，便于后续回溯。

## 内容

- `spec.md` — stage 1 的设计 spec：12 个 grill-me 决策、25 条 user story、能力范围、错误契约、测试决策、stage 2 范围标记（`edit_note` / `delete_note`）。stage 2 完全按该 spec 的"out of scope → stage 2"分支实现。
- `tickets/00..10/` — 11 个执行 ticket，从 v9 migration 到 `smoke-agent` 端到端测试。每个 ticket 文件保留原 checkboxes 状态（全部完成）。

## 实际产物（不在本目录）

代码层面的实现都在以下位置：

| 文件 | 内容 |
|---|---|
| `lib/ai/tools/` | `read_note.ts` / `create_note.ts` / `edit_note.ts` / `delete_note.ts` + 共享的 `agent-audit.ts` / `rate-limit.ts` / `format-tool-result.ts` |
| `lib/ai/tools-config.ts` | `buildToolsConfig()` — 根据 `agent_tools_enabled` 注册工具，所有工具包 `withRateLimit` |
| `lib/ai/chat.ts` | `streamChat` 启用 `maxToolRoundtrips: 3`，把工具输出转 SSE |
| `lib/ai/prompts.ts` | `CHAT_SYSTEM_PROMPT` rule 9（反注入）+ rule 10（工具清单）+ rule 11（禁止捏造） |
| `lib/ai/chat-sse.ts` | stream part → `tool_call` / `tool_result` SSE 事件映射 |
| `components/chat/tool-call-card.tsx` | 工具调用卡片（in_progress / success / error 三态） |
| `app/api/agent/actions/route.ts` | 审计历史读取（GET，paginated） |
| `app/(app)/settings/agent/page.tsx` | 工具开关 UI |
| `scripts/smoke-agent.ts` | 端到端 smoke（mock LLM + 真 DB） |

## 代码-review 历史

每个 ticket 完成后都有一次 review pass：

- ticket 01 → `fix(ai): address ticket 01 code-review findings`
- ticket 02 → `fix(ai): address ticket 02 code-review findings`
- ...
- ticket 06 → `fix(test): address ticket 06 code-review findings (F1-F6)`
- ticket 10 → `fix(ai): address ticket 10 code-review findings (F1-F4)`

ticket 10 review 的 F1-F4 是 stage 2 端到端测试暴露出的 `deleted_at` 过滤遗漏：listNotes 三个 tag-only 分支、listTagTree JOIN、getNoteStats 四个 COUNT 全缺过滤。已修，回归全过。
