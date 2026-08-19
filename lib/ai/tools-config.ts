// lib/ai/tools-config.ts
//
// Build the `tools` config for streamText() based on the agent_tools_enabled
// setting. Extracted into its own function so it can be unit-tested
// without standing up the full chat pipeline.
//
// Per-turn rate limit (ticket 05): when enabled, all tools are
// wrapped with withRateLimit using a fresh limiter so the cap resets
// at the start of each streamChat invocation (= per turn). The cap
// value comes from the agent_tool_limit settings KV (default 5).
//
// Stage 1: { create_note, read_note }
// Stage 2: { create_note, read_note, edit_note, delete_note }
// Future stages may add per-tool gating beyond the master switch.

import type { CoreTool } from 'ai';

import { getAgentBatchEditDeleteEnabled, getAgentToolLimit, getAgentToolsEnabled } from '@/lib/auth/init';

import { makeCreateNoteTool } from './tools/create_note';
import { makeReadNoteTool } from './tools/read_note';
import { makeEditNoteTool } from './tools/edit_note';
import { makeDeleteNoteTool } from './tools/delete_note';
import { makeRateLimiter, withRateLimit } from './tools/rate-limit';
import { makeBatchEditDeleteCounter, withBatchEditDeleteGuard } from './tools/batch-guard';
import type { AgentAuditContext } from './tools/agent-audit';

export type ToolsConfig = Record<string, CoreTool>;

export function buildToolsConfig(
  context: AgentAuditContext = {},
): ToolsConfig {
  if (!getAgentToolsEnabled()) return {};
  const limiter = makeRateLimiter(getAgentToolLimit());
  const batchCounter = makeBatchEditDeleteCounter();
  const batchEnabled = getAgentBatchEditDeleteEnabled();
  const createNoteTool = makeCreateNoteTool(context);
  const readNoteTool = makeReadNoteTool(context);
  const editNoteTool = makeEditNoteTool(context);
  const deleteNoteTool = makeDeleteNoteTool(context);
  // withRateLimit preserves description / parameters / etc. via the
  // spread inside the helper and is generic in the input tool type,
  // so the returned CoreTool types flow through unchanged.
  return {
    create_note: withRateLimit(createNoteTool, limiter, {
      actionType: 'create_note',
      context,
    }),
    read_note: withRateLimit(readNoteTool, limiter, {
      actionType: 'read_note',
      context,
    }),
    edit_note: withBatchEditDeleteGuard(
      withRateLimit(editNoteTool, limiter, {
        actionType: 'edit_note',
        context,
      }),
      batchCounter,
      batchEnabled,
      'edit_note',
      context,
    ),
    delete_note: withBatchEditDeleteGuard(
      withRateLimit(deleteNoteTool, limiter, {
        actionType: 'delete_note',
        context,
      }),
      batchCounter,
      batchEnabled,
      'delete_note',
      context,
    ),
  };
}
