// Quick diagnostic: dump notes + their image refs
import { getDb } from '../lib/db/client';

const db = getDb();
const rows = db
  .prepare(
    "SELECT id, title, substr(content_json, 1, 1500) as snippet FROM notes ORDER BY updated_at DESC",
  )
  .all() as { id: string; title: string; snippet: string }[];

for (const r of rows) {
  console.log('---', r.id, '|', r.title);
  // Pretty print: find image refs
  const imgMatches = r.snippet.match(/"src":\s*"[^"]*"/g) ?? [];
  if (imgMatches.length > 0) {
    console.log('  image refs found in snippet:');
    for (const m of imgMatches) console.log('   ', m);
  }
  // Also dump first 400 chars
  console.log('  content[0..400]:', r.snippet.slice(0, 400));
  console.log('');
}
