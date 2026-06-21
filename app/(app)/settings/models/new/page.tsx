// Settings → Models → New — create a new model configuration.

import Link from 'next/link';
import { ModelForm } from '@/components/models/model-form';

export default function NewModelPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings/models"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 返回模型列表
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">新建模型</h1>
        <p className="text-sm text-muted-foreground">
          填写模型信息，API Key 入库前会加密保存。
        </p>
      </div>
      <ModelForm mode="create" />
    </div>
  );
}
