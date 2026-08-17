// lib/search/config.test.ts
//
// Regression test for search-provider settings. The public config payload
// must not include the encrypted API-key row, because the settings form sends
// that payload back when saving a replacement key.
//
// Run: npx tsx lib/search/config.test.ts

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

export {};

type Case = {
  name: string;
  check: () => boolean;
};

async function main(): Promise<void> {
  const { parseSearchProviderConfigRows } = await import('./config');

  const configs = parseSearchProviderConfigRows([
    { key: 'search_provider_tavily_key', value: 'old-encrypted-key' },
    { key: 'search_provider_tavily_count', value: '5' },
    { key: 'search_provider_metaso_scope', value: 'webpage' },
    { key: 'search_provider_bocha_key', value: 'another-encrypted-key' },
  ]);

  const cases: Case[] = [
    {
      name: 'public configs omit encrypted provider API keys',
      check: () =>
        configs.tavily?.key === undefined && configs.bocha?.key === undefined,
    },
    {
      name: 'public configs retain ordinary provider parameters',
      check: () =>
        configs.tavily?.count === '5' &&
        configs.metaso?.scope === 'webpage',
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
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
