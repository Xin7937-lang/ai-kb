'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Globe, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ProviderMeta = {
  type: 'tavily' | 'metaso' | 'bocha';
  name: string;
  hasKey: boolean;
};

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

const METASO_SCOPE_OPTIONS: { label: string; value: string }[] = [
  { label: '网页', value: 'webpage' },
  { label: '文库', value: 'document' },
  { label: '学术', value: 'scholar' },
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
  { label: '播客', value: 'podcast' },
];

export function SearchSettingsForm({
  initialProviders,
  initialActiveProvider,
  initialConfigs = {},
}: {
  initialProviders: ProviderMeta[];
  initialActiveProvider: string | null;
  initialConfigs?: Record<string, Record<string, string>>;
}) {
  const router = useRouter();
  const [providers, setProviders] = useState(
    initialProviders.map((p) => ({
      type: p.type,
      name: p.name,
      enabled: p.hasKey,
      apiKey: '',
    })),
  );
  const [activeProvider, setActiveProvider] = useState(
    initialActiveProvider || '',
  );
  const [configs, setConfigs] =
    useState<Record<string, Record<string, string>>>(initialConfigs);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Per-provider test status
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [testError, setTestError] = useState<Record<string, string>>({});

  const hasChanges =
    providers.some((p) => {
      const initial = initialProviders.find((i) => i.type === p.type);
      return (
        p.enabled !== (initial?.hasKey ?? false) || p.apiKey !== ''
      );
    }) ||
    activeProvider !== (initialActiveProvider || '') ||
    JSON.stringify(configs) !== JSON.stringify(initialConfigs);

  function updateConfig(type: string, param: string, value: string) {
    setConfigs((prev) => ({
      ...prev,
      [type]: { ...(prev[type] || {}), [param]: value },
    }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {};
        for (const p of providers) {
          if (!p.enabled) {
            payload[p.type] = null;
          } else if (p.apiKey !== '') {
            payload[p.type] = p.apiKey;
          }
        }
        payload.activeProvider = activeProvider || null;
        payload.configs = configs;

        const res = await fetch('/api/settings/search-providers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.message ?? data.error ?? '保存失败');
          return;
        }
        setSuccess(true);
        router.refresh();
      } catch (err) {
        console.error('[search-settings] failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  async function testProvider(type: string, apiKey: string) {
    setTestStatus((prev) => ({ ...prev, [type]: 'loading' }));
    setTestError((prev) => ({ ...prev, [type]: '' }));

    try {
      const body: Record<string, string> = { provider: type };
      if (apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }

      const res = await fetch('/api/settings/search-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (data.ok) {
        setTestStatus((prev) => ({ ...prev, [type]: 'success' }));
        setTimeout(() => {
          setTestStatus((prev) => ({ ...prev, [type]: 'idle' }));
        }, 3000);
      } else {
        setTestStatus((prev) => ({ ...prev, [type]: 'error' }));
        setTestError((prev) => ({
          ...prev,
          [type]: data.error ?? '测试失败',
        }));
        setTimeout(() => {
          setTestStatus((prev) => ({ ...prev, [type]: 'idle' }));
        }, 3000);
      }
    } catch (err) {
      setTestStatus((prev) => ({ ...prev, [type]: 'error' }));
      setTestError((prev) => ({ ...prev, [type]: '网络错误' }));
      setTimeout(() => {
        setTestStatus((prev) => ({ ...prev, [type]: 'idle' }));
      }, 3000);
    }
  }

  const enabledProviders = providers.filter((p) => p.enabled);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            外部搜索 API
          </CardTitle>
          <CardDescription>
            配置第三方搜索服务，AI 将在回答时同时调用搜索 API 获取网络结果作为参考。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {providers.map((p) => (
            <div key={p.type} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`enable-${p.type}`} className="text-sm font-medium">
                  {p.name}
                </Label>
                <Switch
                  id={`enable-${p.type}`}
                  checked={p.enabled}
                  onCheckedChange={(v) =>
                    setProviders((prev) =>
                      prev.map((x) =>
                        x.type === p.type ? { ...x, enabled: v } : x,
                      ),
                    )
                  }
                  disabled={isPending}
                />
              </div>
              {p.enabled ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`key-${p.type}`}
                      type="password"
                      value={p.apiKey}
                      onChange={(e) =>
                        setProviders((prev) =>
                          prev.map((x) =>
                            x.type === p.type
                              ? { ...x, apiKey: e.target.value }
                              : x,
                          ),
                        )
                      }
                      placeholder={
                        initialProviders.find((i) => i.type === p.type)?.hasKey
                          ? '已配置，输入新值覆盖'
                          : '输入 API Key'
                      }
                      disabled={isPending}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testProvider(p.type, p.apiKey)}
                      disabled={testStatus[p.type] === 'loading'}
                    >
                      {testStatus[p.type] === 'loading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : testStatus[p.type] === 'success' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : testStatus[p.type] === 'error' ? (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      ) : (
                        '测试'
                      )}
                    </Button>
                  </div>

                  {/* Bocha config: result count */}
                  {p.type === 'bocha' ? (
                    <div className="flex items-center gap-2 pl-1">
                      <Label htmlFor="bocha-count" className="text-xs text-muted-foreground whitespace-nowrap">
                        搜索结果数量
                      </Label>
                      <Input
                        id="bocha-count"
                        type="number"
                        min={10}
                        max={50}
                        value={configs.bocha?.count ?? '10'}
                        onChange={(e) => updateConfig('bocha', 'count', e.target.value)}
                        disabled={isPending}
                        className="h-8 w-20 text-xs"
                      />
                    </div>
                  ) : null}

                  {/* Tavily config: result count */}
                  {p.type === 'tavily' ? (
                    <div className="flex items-center gap-2 pl-1">
                      <Label htmlFor="tavily-count" className="text-xs text-muted-foreground whitespace-nowrap">
                        搜索结果数量
                      </Label>
                      <Input
                        id="tavily-count"
                        type="number"
                        min={1}
                        max={20}
                        value={configs.tavily?.count ?? '5'}
                        onChange={(e) => updateConfig('tavily', 'count', e.target.value)}
                        disabled={isPending}
                        className="h-8 w-20 text-xs"
                      />
                    </div>
                  ) : null}

                  {/* Metaso config */}
                  {p.type === 'metaso' ? (
                    <div className="ml-1 space-y-3 border-l-2 border-muted pl-3">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="metaso-scope" className="text-xs text-muted-foreground whitespace-nowrap">
                          搜索范围
                        </Label>
                        <select
                          id="metaso-scope"
                          value={configs.metaso?.scope ?? 'webpage'}
                          onChange={(e) => updateConfig('metaso', 'scope', e.target.value)}
                          disabled={isPending}
                          className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {METASO_SCOPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <Label htmlFor="metaso-size" className="text-xs text-muted-foreground whitespace-nowrap">
                          搜索结果数量
                        </Label>
                        <Input
                          id="metaso-size"
                          type="number"
                          min={10}
                          max={100}
                          value={configs.metaso?.size ?? '10'}
                          onChange={(e) => updateConfig('metaso', 'size', e.target.value)}
                          disabled={isPending}
                          className="h-8 w-20 text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Label htmlFor="metaso-conciseSnippet" className="text-xs text-muted-foreground whitespace-nowrap">
                          返回精简的原文匹配信息
                        </Label>
                        <Switch
                          id="metaso-conciseSnippet"
                          checked={configs.metaso?.conciseSnippet === 'true'}
                          onCheckedChange={(v) =>
                            updateConfig('metaso', 'conciseSnippet', v ? 'true' : 'false')
                          }
                          disabled={isPending}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Label htmlFor="metaso-includeSummary" className="text-xs text-muted-foreground whitespace-nowrap">
                          通过网页的摘要信息进行召回增强
                        </Label>
                        <Switch
                          id="metaso-includeSummary"
                          checked={configs.metaso?.includeSummary !== 'false'}
                          onCheckedChange={(v) =>
                            updateConfig('metaso', 'includeSummary', v ? 'true' : 'false')
                          }
                          disabled={isPending}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {testStatus[p.type] === 'error' && testError[p.type] ? (
                <p className="text-xs text-destructive">{testError[p.type]}</p>
              ) : null}
            </div>
          ))}

          <div className="space-y-2">
            <Label htmlFor="active-provider">当前使用的搜索服务</Label>
            <select
              id="active-provider"
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value)}
              disabled={isPending}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">不使用外部搜索</option>
              {enabledProviders.map((p) => (
                <option key={p.type} value={p.type}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              在「与笔记对话」中，开启「启用外网搜索」后，AI 会同时调用当前选择的搜索服务获取网络结果。
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p
              className="text-sm text-emerald-600 dark:text-emerald-400"
              role="status"
            >
              已保存。
            </p>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending || !hasChanges}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
