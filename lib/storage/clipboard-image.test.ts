// Focused regression test for clipboard image selection.
//
// Run: npx tsx lib/storage/clipboard-image.test.ts

import { selectClipboardImage, type ClipboardItemLike } from './clipboard-image';

type FakeFile = {
  name: string;
  type: string;
};

type Case = {
  name: string;
  items: ClipboardItemLike<FakeFile>[];
  expected: FakeFile | null;
};

const png: FakeFile = { name: 'screenshot.png', type: 'image/png' };
const jpeg: FakeFile = { name: 'photo.jpg', type: 'image/jpeg' };

const cases: Case[] = [
  {
    name: 'selects the first supported image',
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => jpeg },
    ],
    expected: png,
  },
  {
    name: 'image takes priority over text and HTML items',
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'string', type: 'text/html', getAsFile: () => null },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => jpeg },
    ],
    expected: jpeg,
  },
  {
    name: 'unsupported images fall back to normal paste',
    items: [
      { kind: 'file', type: 'image/bmp', getAsFile: () => ({ name: 'x.bmp', type: 'image/bmp' }) },
    ],
    expected: null,
  },
  {
    name: 'text-only paste falls back to normal paste',
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    expected: null,
  },
];

let failed = 0;
for (const testCase of cases) {
  try {
    const result = selectClipboardImage(testCase.items);
    if (result !== testCase.expected) {
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
