import { getDb } from '@/lib/db/client';

const db = getDb();

const models = db.prepare('SELECT id, name, base_url, model, kind, is_default FROM model_configs').all() as Array<{ id: string; name: string; base_url: string; model: string; kind: string; is_default: number }>;
console.log('Model configs:');
for (const m of models) {
  console.log(`  id=${m.id} name=${m.name} kind=${m.kind} model=${m.model} base_url=${m.base_url} is_default=${m.is_default}`);
}

process.exit(0);
