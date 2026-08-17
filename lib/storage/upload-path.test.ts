// Focused regression test for public upload path resolution.
//
// Run: npx tsx lib/storage/upload-path.test.ts

import path from 'path';
import { tmpdir } from 'os';
import { resolveUploadPath } from './upload-path';

type Case = {
  name: string;
  check: () => boolean;
};

const root = path.join(tmpdir(), 'ai-kb-upload-path-test');
const resolvedRoot = path.resolve(root);

const cases: Case[] = [
  {
    name: 'resolves a normal upload path under the upload root',
    check: () =>
      resolveUploadPath(root, ['2024', '01', 'image.png']) ===
      path.join(resolvedRoot, '2024', '01', 'image.png'),
  },
  {
    name: 'rejects parent-directory traversal',
    check: () => resolveUploadPath(root, ['2024', '..', '..', 'secret.txt']) === null,
  },
  {
    name: 'rejects a path that only shares the upload root prefix',
    check: () => resolveUploadPath(root, ['..', 'ai-kb-uploads-elsewhere', 'file.png']) === null,
  },
  {
    name: 'rejects an empty path',
    check: () => resolveUploadPath(root, []) === null,
  },
];

let failed = 0;
for (const testCase of cases) {
  try {
    if (!testCase.check()) {
      console.error(`FAIL: ${testCase.name}`);
      failed++;
    } else {
      console.log(`PASS: ${testCase.name}`);
    }
  } catch (err) {
    console.error(`ERROR in ${testCase.name}:`, err);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} tests passed`);
