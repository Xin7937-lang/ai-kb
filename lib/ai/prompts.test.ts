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

async function main(): Promise<void> {
  const disabledPrompt = buildChatSystemPrompt(false, false, false);
  const enabledPrompt = buildChatSystemPrompt(false, false, true);

  const cases: Case[] = [
    // S5 — anti-injection: prompt must warn about treating note
    // content as instructions, not as data.
    {
      name: 'contains anti-injection paragraph (mentions note content + untrusted / instructions)',
      check: () => {
        const lower = disabledPrompt.toLowerCase();
        // Look for the chinese keywords we plan to put in the prompt.
        return (
          disabledPrompt.includes('不可信') ||
          disabledPrompt.includes('不可信输入') ||
          disabledPrompt.includes('指令') ||
          disabledPrompt.includes('当作数据') ||
          disabledPrompt.includes('当作指令')
        );
      },
    },

    // S6 — tool list: must enumerate create_note + read_note + edit_note + delete_note.
    {
      name: 'explicitly lists create_note as available tool',
      check: () => disabledPrompt.includes('create_note'),
    },
    {
      name: 'explicitly lists read_note as available tool',
      check: () => disabledPrompt.includes('read_note'),
    },
    {
      name: 'explicitly lists edit_note as available tool',
      check: () => disabledPrompt.includes('edit_note'),
    },
    {
      name: 'explicitly lists delete_note as available tool',
      check: () => disabledPrompt.includes('delete_note'),
    },
    {
      name: 'does NOT mention a nonexistent tool (e.g. summarize_note)',
      check: () => !disabledPrompt.includes('summarize_note'),
    },

    // S7 — no-fabrication: must forbid claiming actions that
    // didn't happen.
    {
      name: 'forbids claiming to perform actions you did not perform',
      check: () => {
        const lower = disabledPrompt.toLowerCase();
        return (
          disabledPrompt.includes('不要声称') ||
          disabledPrompt.includes('不要假装') ||
          disabledPrompt.includes('未执行') ||
          disabledPrompt.includes('未实际') ||
          disabledPrompt.includes('不要捏造') ||
          disabledPrompt.includes('不要伪造')
        );
      },
    },

    // Batch edit/delete guard prompt rule.
    {
      name: 'disabled prompt contains batch edit/delete restriction rule',
      check: () =>
        disabledPrompt.includes('批量修改限制') &&
        disabledPrompt.includes('设置 → Agent') &&
        disabledPrompt.includes('edit_note') &&
        disabledPrompt.includes('delete_note'),
    },
    {
      name: 'enabled prompt does NOT contain batch restriction rule',
      check: () => !enabledPrompt.includes('批量修改限制'),
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        console.error(`  disabled prompt length: ${disabledPrompt.length}`);
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
