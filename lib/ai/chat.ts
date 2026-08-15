// Chat pipeline: retrieve -> build messages -> SSE stream.
//
// One `streamChat` call = one turn. The function:
//   1. Finds the last user turn (the current question) and uses it to
//      drive FTS5 retrieval. The conversation history is for context
//      understanding only -- it does NOT affect retrieval.
//   2. Truncates the history to the last N user turns to keep the
//      context window bounded.
//   3. Builds a system prompt with the retrieved notes folded in.
//   4. Calls `streamText` with the full message list and the system
//      prompt. The AI SDK handles the multi-turn conversation.
//   5. Emits an SSE byte stream: a `sources` event with the retrieved
//      note ids, `delta` events for the live text, and a final `done`.
//
// Multi-turn design:
//   - Retrieval is driven ONLY by the current (last) user turn -- the
//     prior turns are short-lived conversational context. This avoids
//     a follow-up like "讲得通俗点" overwriting the original topic.
//   - The conversation history is capped at MAX_HISTORY_USER_TURNS
//     (10) user turns to bound token usage.
//   - The retrieved context is folded into the system prompt so the
//     message list stays clean and the model treats it as global
//     reference for the whole thread.

import { streamText } from 'ai';
import { getModelAndClient, getDefaultModelId } from './provider';
import { NoDefaultModelError, NoSuchModelError } from './errors';
import { buildChatContext, buildChatSystemPrompt } from './prompts';
import { searchRelevantChunks } from './retrieval';
import type { RetrievedChunk } from './retrieval-types';
import { searchWeb } from '@/lib/search';
import { buildToolsConfig } from './tools-config';

/**
 * Cap on how many prior user turns we feed to the model. 10 is well
 * within the context window of every supported model and keeps the
 * "上下文太长" risk low for very long threads. The current question
 * (the last user turn) is always retained on top of this cap.
 */
const MAX_HISTORY_USER_TURNS = 10;

export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatStreamResult = {
  stream: ReadableStream<Uint8Array>;
  sources: RetrievedChunk[];
  modelId: string;
  modelName: string;
  isWebSearch: boolean;
};

export type StreamChatOptions = {
  modelId?: string;
  webSearchEnabled?: boolean;
};

export async function streamChat(
  messages: ChatTurn[],
  opts: StreamChatOptions = {},
): Promise<ChatStreamResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('chat: messages must be a non-empty array');
  }

  // 1. Find the last user turn (the current question).
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) {
    throw new Error('chat: at least one user turn is required');
  }
  const currentQuestion = messages[lastUserIdx].content.trim();
  if (!currentQuestion) {
    throw new Error('chat: current question is empty');
  }

  // 2. Truncate to the last N user turns. We compute user-turn
  //    indices in document order, then drop everything before the
  //    Nth-from-last user turn. The current user turn is always
  //    retained (it's at the tail).
  const userTurnIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') userTurnIndices.push(i);
  }
  const cutoff =
    userTurnIndices.length > MAX_HISTORY_USER_TURNS
      ? userTurnIndices[userTurnIndices.length - MAX_HISTORY_USER_TURNS]
      : 0;
  const truncated = messages.slice(cutoff);

  // 3. Retrieve based on the current question (only). Multi-signal
  //    re-rank inside `searchRelevantChunks` already prefers recent
  //    notes + title hits.
  const sources = await searchRelevantChunks(currentQuestion);
  console.error('[chat debug] query:', currentQuestion, '->', sources.length, 'chunks');
  for (const s of sources) {
    console.error(`[chat debug]   title="${s.title}" chunkId=${s.chunkId} score=${s.score.toFixed(4)} paths=${JSON.stringify(s.paths)} len=${s.content.length}`);
    console.error(`[chat debug]     content="${s.content.slice(0, 300)}"`);
  }
  const modelConfigId = opts.modelId ?? getDefaultModelId();
  const { client, modelId, modelName } = getModelAndClient(modelConfigId);

  const hasSources = sources.length > 0;
  const webSearchEnabled = opts.webSearchEnabled ?? false;

  // 只要启用了外网搜索，就调用搜索 API（不管笔记是否有匹配）
  let webSearchContext = '';
  if (webSearchEnabled) {
    const webResults = await searchWeb(currentQuestion);
    if (webResults && webResults.length > 0) {
      webSearchContext =
        '\n\n# 网络搜索结果\n\n' +
        webResults
          .map(
            (r, i) =>
              `[结果 ${i + 1}] [${r.title}](${r.url})\n摘要：${r.snippet}`,
          )
          .join('\n\n---\n\n');
    }
  }

  // isWebSearch 标记用于前端显示「此回答包含网络搜索结果」
  const isWebSearch = webSearchEnabled && webSearchContext !== '';

  const context = buildChatContext(
    sources.map((s) => ({
      chunkId: s.chunkId,
      noteId: s.noteId,
      title: s.title,
      content: s.content,
      tags: s.tags,
    })),
  );

  const systemPrompt = `${buildChatSystemPrompt(opts.webSearchEnabled ?? false, hasSources)}\n\n# 检索到的笔记\n\n${context}${webSearchContext}`;

  // 4. Run the model with the full (truncated) conversation.
  const tools = buildToolsConfig();
  const result = await streamText({
    model: client.chat(modelId),
    system: systemPrompt,
    messages: truncated,
    temperature: 0.3,
    tools,
  });

  // 5. Encode SSE.
  const encoder = new TextEncoder();
  // Pre-encode the sources event so the client knows which notes
  // were used to generate the answer.
  const sourcesEvent = `data: ${JSON.stringify({
    sources: sources.map((s) => ({
      id: s.noteId,
      title: s.title,
      chunkIndexes: [s.chunkId],
    })),
    isWebSearch,
  })}\n\n`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send sources up front so the client can render the "Sources"
      // panel before the first token lands.
      controller.enqueue(encoder.encode(sourcesEvent));
      let accumulated = '';
      try {
        for await (const delta of result.textStream) {
          if (!delta) continue;
          accumulated += delta;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
          );
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, fullText: accumulated })}\n\n`,
          ),
        );
        controller.close();
      } catch (err) {
        const msg = errorMessage(err);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
          );
        } finally {
          controller.close();
        }
      }
    },
  });

  return { stream, sources, modelId, modelName, isWebSearch };
}

function errorMessage(err: unknown): string {
  if (err instanceof NoSuchModelError) return 'no_such_model';
  if (err instanceof NoDefaultModelError) return 'no_default_model';
  if (err instanceof Error) {
    return err.message || err.name || 'unknown_error';
  }
  return 'unknown_error';
}
