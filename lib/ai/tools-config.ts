// lib/ai/tools-config.ts
//
// Build the `tools` config for streamText() based on the agent_tools_enabled
// setting. Extracted into its own function so it can be unit-tested
// without standing up the full chat pipeline.
//
// Per-turn rate limit (ticket 05): when enabled, both tools are
// wrapped with withRateLimit using a fresh limiter so the cap resets
// at the start of each streamChat invocation (= per turn). The cap
// value comes from the agent_tool_limit settings KV (default 5).
//
// Stage 1: { create_note, read_note }
// Stage 2 (deferred): add edit_note, delete_note
// Future stages may add per-tool gating beyond the master switch.

import type { CoreTool } from 'ai';

import { getAgentToolLimit, getAgentToolsEnabled } from '@/lib/auth/init';

import { createNoteTool } from './tools/create_note';
import { readNoteTool } from './tools/read_note';
import { makeRateLimiter, withRateLimit } from './tools/rate-limit';

export type ToolsConfig = Record<string, CoreTool>;

export function buildToolsConfig(): ToolsConfig {
  if (!getAgentToolsEnabled()) return {};
  const limiter = makeRateLimiter(getAgentToolLimit());
  // withRateLimit returns a narrower type (just `execute`) than
  // CoreTool (which also carries `parameters`, `description`, etc.).
  // The wrapper is a structural superset via the spread, but TS
  // can't prove that; cast through unknown to assign back.
  return {
    create_note: withRateLimit(createNoteTool, limiter) as unknown as CoreTool,
    read_note: withRateLimit(readNoteTool, limiter) as unknown as CoreTool,
  };
}