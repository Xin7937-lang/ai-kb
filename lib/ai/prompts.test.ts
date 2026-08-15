// lib/ai/prompts.test.ts
//
// Throwaway test for CHAT_SYSTEM_PROMPT additions in ticket 05
// (anti-injection, tool list, no-fabrication rule). Mirrors the
// no-test-framework rule (AGENTS.md).
//
// Run: npx tsx lib/ai/prompts.test.ts

import { buildChatSystemPrompt } from './prompts';

type Case = {
  name: string;
  check: () => boolean;
};

let promptText = '';

async function main(): Promise<void> {
  promptText = buildChatSystemPrompt(false, false);

  const cases: Case[] = [
    // S5 — anti-injection: prompt must warn about treating note
    // content as instructions, not as data.
    {
      name: 'contains anti-injection paragraph (mentions note content + untrusted / instructions)',
      check: () => {
        const lower = promptText.toLowerCase();
        // Look for the chinese keywords we plan to put in the prompt.
        return (
          promptText.includes('不可信') ||
          promptText.includes('不可信输入') ||
          promptText.includes('指令') ||
          promptText.includes('当作数据') ||
          promptText.includes('当作指令')
        );
      },
    },

    // S6 — tool list: must enumerate create_note + read_note.
    {
      name: 'explicitly lists create_note as available tool',
      check: () => promptText.includes('create_note'),
    },
    {
      name: 'explicitly lists read_note as available tool',
      check: () => promptText.includes('read_note'),
    },
    {
      name: 'does NOT mention delete_note (model has no such tool)',
      check: () => !promptText.includes('delete_note'),
    },

    // S7 — no-fabrication: must forbid claiming actions that
    // didn't happen.
    {
      name: 'forbids claiming to perform actions you did not perform',
      check: () => {
        const lower = promptText.toLowerCase();
        return (
          promptText.includes('不要声称') ||
          promptText.includes('不要假装') ||
          promptText.includes('未执行') ||
          promptText.includes('未实际') ||
          promptText.includes('不要捏造') ||
          promptText.includes('不要伪造')
        );
      },
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        console.error(`  prompt length: ${promptText.length}`);
        failed++;
      } else {
        console.log(`PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} tests passed`);
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});