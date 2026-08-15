// lib/ai/tools-config.ts
//
// Build the `tools` config for streamText() based on the agent_tools_enabled
// setting. Extracted into its own function so it can be unit-tested
// without standing up the full chat pipeline.
//
// Stage 1: { create_note, read_note }
// Stage 2 (deferred): add edit_note, delete_note
// Future stages may add per-tool gating beyond the master switch.

import type { CoreTool } from 'ai';

import { getAgentToolsEnabled } from '@/lib/auth/init';

import { createNoteTool } from './tools/create_note';
import { readNoteTool } from './tools/read_note';

export type ToolsConfig = Record<string, CoreTool>;

export function buildToolsConfig(): ToolsConfig {
  if (!getAgentToolsEnabled()) return {};
  return {
    create_note: createNoteTool,
    read_note: readNoteTool,
  };
}