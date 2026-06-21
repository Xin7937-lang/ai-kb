// One row in the model_configs list. Renders as a clickable card linking
// to the edit page. The "default" badge is shown only for the row whose
// is_default flag is set. The "向量" chip is shown for embedding models.

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type ModelListItemData = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  kind: 'chat' | 'embedding';
  isDefault: boolean;
  createdAt: number;
};

type Props = {
  model: ModelListItemData;
};

export function ModelListItem({ model }: Props) {
  return (
    <Link href={`/settings/models/${model.id}`} className="block group">
      <Card
        className={cn(
          'p-4 transition-colors group-hover:bg-accent/50',
          model.isDefault && 'border-primary',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{model.name}</h3>
              {model.isDefault ? (
                <span className="inline-flex items-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  默认
                </span>
              ) : null}
              {model.kind === 'embedding' ? (
                <span className="inline-flex items-center rounded-full border border-accent bg-accent/20 px-2 py-0.5 text-xs text-accent-foreground">
                  向量
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground truncate">
              <code className="text-xs">{model.model}</code>
              <span className="mx-2">·</span>
              <span className="text-xs">{model.baseUrl}</span>
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
