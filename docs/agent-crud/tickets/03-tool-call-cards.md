# 03 — Tool-call cards in chat UI

**What to build:** When the agent invokes any tool during a chat turn, the user sees a compact inline card in the chat stream showing the tool name and status. Cards let the user see what the agent is doing without leaving the chat.

**Blocked by:** 01 (need at least one tool to render cards against during development)

**Status:** ready-for-agent

- [ ] New chat component renders each tool invocation as a compact inline card with three states: in-progress (with spinner), success (one-line confirmation expandable to show params + result), error (red indicator with error code)
- [ ] Component is wired into the chat window via Vercel AI SDK's `onToolCall` hook — no new client/server boundary introduced
- [ ] Cards appear inline within the assistant message stream, not in a separate region
- [ ] Cards match the existing chat stream typography: single-line height by default, no jarring visual elements, consistent with the existing message bubbles
- [ ] The expand/collapse interaction for showing params and result is keyboard-accessible and screen-reader friendly (button with `aria-expanded`)
- [ ] Visual smoke: with toggle ON, asking the agent to create a note produces a card transitioning from in-progress to success in the chat stream
- [ ] Visual smoke: with the rate limit hit, the card shows the error state with the appropriate error code visible
- [ ] No regression: pure Q&A chat (no tool invocations) renders exactly as it does today