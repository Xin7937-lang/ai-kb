'use client';

// /settings/agent — toggle the /chat agent's tool-calling capability
// and browse the audit history of recent tool invocations. Audit
// history supports pagination (20 rows per page) and filtering by
// conversation ID.

import { useEffect, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, History, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { AgentAuditResultCode } from '@/lib/ai/tools/agent-audit';

type AgentAction = {
  id: string;
  conversationId: string | null;
  actionType: string;
  targetNoteId: string | null;
  paramsJson: string | null;
  result: AgentAuditResultCode;
  errorMessage: string | null;
  createdAt: number;
};

const PAGE_SIZE = 20;

export function AgentSettings({
  initialEnabled,
  initialBatchEditDeleteEnabled,
}: {
  initialEnabled: boolean;
  initialBatchEditDeleteEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [batchEditDeleteEnabled, setBatchEditDeleteEnabled] = useState(
    initialBatchEditDeleteEnabled,
  );
  const [batchSaveStatus, setBatchSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [batchSaveError, setBatchSaveError] = useState<string | null>(null);

  const [actions, setActions] = useState<AgentAction[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [conversationFilter, setConversationFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [page, setPage] = useState(0);

  async function loadAudit(filter: string, offset: number) {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const params = new URLSearchParams();
      if (filter) params.set('conversationId', filter);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      const qs = params.toString();
      const res = await fetch(`/api/agents/actions${qs ? `?${qs}` : ''}`);
      const json = (await res.json().catch(() => ({}))) as {
        data?: AgentAction[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.data) {
        setAuditError(json.message ?? json.error ?? '加载审计失败');
        setActions(null);
        return;
      }
      setActions(json.data);
    } catch (err) {
      console.error('[agent-settings] audit fetch failed:', err);
      setAuditError('网络错误，请重试');
    } finally {
      setAuditLoading(false);
    }
  }

  // Load audit history on mount; reload when filter or page changes.
  useEffect(() => {
    loadAudit(appliedFilter, page * PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilter, page]);

  function applyFilter() {
    setPage(0);
    setAppliedFilter(conversationFilter.trim());
  }

  function goPrev() {
    setPage((p) => Math.max(0, p - 1));
  }

  function goNext() {
    // Only allow if current page was full — likely more rows.
    if (actions && actions.length === PAGE_SIZE) {
      setPage((p) => p + 1);
    }
  }

  function onToggle(next: boolean) {
    setEnabled(next);
    setSaveError(null);
    setSaveStatus('saving');
    fetch('/api/settings/agent-tools-enabled', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setSaveStatus('error');
          setSaveError(json.message ?? json.error ?? '保存失败');
          setEnabled(!next);
          return;
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1500);
      })
      .catch((err) => {
        console.error('[agent-settings] toggle failed:', err);
        setSaveStatus('error');
        setSaveError('网络错误，请重试');
        setEnabled(!next);
      });
  }

  function onBatchEditDeleteToggle(next: boolean) {
    setBatchEditDeleteEnabled(next);
    setBatchSaveError(null);
    setBatchSaveStatus('saving');
    fetch('/api/settings/agent-batch-edit-delete-enabled', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setBatchSaveStatus('error');
          setBatchSaveError(json.message ?? json.error ?? '保存失败');
          setBatchEditDeleteEnabled(!next);
          return;
        }
        setBatchSaveStatus('saved');
        setTimeout(() => setBatchSaveStatus('idle'), 1500);
      })
      .catch((err) => {
        console.error('[agent-settings] batch toggle failed:', err);
        setBatchSaveStatus('error');
        setBatchSaveError('网络错误，请重试');
        setBatchEditDeleteEnabled(!next);
      });
  }

  const pageStart = page * PAGE_SIZE + 1;
  const pageEnd = page * PAGE_SIZE + (actions?.length ?? 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Agent 工具调用
          </CardTitle>
          <CardDescription>
            开启后，/chat 的 AI 可以调用 create_note（创建笔记）和
            read_note（查找笔记）两个工具。关闭后回到纯文本回答。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="agent-tools-enabled"
              checked={enabled}
              onCheckedChange={onToggle}
            />
            <Label htmlFor="agent-tools-enabled" className="cursor-pointer">
              {enabled ? '已开启' : '已关闭'}
            </Label>
            <span aria-live="polite" className="ml-auto text-xs text-muted-foreground">
              {saveStatus === 'saving'
                ? '保存中…'
                : saveStatus === 'saved'
                  ? '已保存'
                  : saveStatus === 'error'
                    ? '保存失败'
                    : ''}
            </span>
          </div>
          {saveError ? (
            <p className="text-sm text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            批量编辑与删除
          </CardTitle>
          <CardDescription>
            开启后，同一轮对话中 AI 可以多次调用 edit_note / delete_note。
            关闭时仅允许每轮执行一次修改或删除，降低误操作风险。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="agent-batch-edit-delete-enabled"
              checked={batchEditDeleteEnabled}
              onCheckedChange={onBatchEditDeleteToggle}
              disabled={!enabled}
            />
            <Label
              htmlFor="agent-batch-edit-delete-enabled"
              className={enabled ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground'}
            >
              {batchEditDeleteEnabled ? '已允许' : '已禁止'}
            </Label>
            <span aria-live="polite" className="ml-auto text-xs text-muted-foreground">
              {batchSaveStatus === 'saving'
                ? '保存中…'
                : batchSaveStatus === 'saved'
                  ? '已保存'
                  : batchSaveStatus === 'error'
                    ? '保存失败'
                    : ''}
            </span>
          </div>
          {batchSaveError ? (
            <p className="text-sm text-destructive" role="alert">
              {batchSaveError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            审计记录
          </CardTitle>
          <CardDescription>
            每页 {PAGE_SIZE} 条，按时间倒序。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="conversation-filter">按对话 ID 过滤（可选）</Label>
              <Input
                id="conversation-filter"
                value={conversationFilter}
                onChange={(e) => setConversationFilter(e.target.value)}
                placeholder="留空查看全部"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFilter();
                  }
                }}
              />
            </div>
            <Button onClick={applyFilter} disabled={auditLoading}>
              应用
            </Button>
          </div>

          {auditError ? (
            <p className="text-sm text-destructive" role="alert">
              {auditError}
            </p>
          ) : null}

          {auditLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载中…
            </div>
          ) : actions && actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {appliedFilter ? '该对话暂无工具调用。' : '尚无工具调用。开启 Agent 工具后调用一次即可看到记录。'}
            </p>
          ) : actions ? (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">时间</th>
                      <th className="px-2 py-1.5 font-medium">动作</th>
                      <th className="px-2 py-1.5 font-medium">目标笔记</th>
                      <th className="px-2 py-1.5 font-medium">结果</th>
                      <th className="px-2 py-1.5 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                          {new Date(a.createdAt).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-2 py-1.5 font-medium">{a.actionType}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">
                          {a.targetNoteId ?? '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <ResultBadge result={a.result} />
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {a.errorMessage ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  第 {pageStart}–{pageEnd} 条
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goPrev}
                    disabled={page === 0 || auditLoading}
                  >
                    <ChevronLeft className="mr-1 h-3 w-3" />
                    上一页
                  </Button>
                  <span className="px-2">第 {page + 1} 页</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goNext}
                    disabled={!actions || actions.length < PAGE_SIZE || auditLoading}
                  >
                    下一页
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultBadge({ result }: { result: AgentAuditResultCode }) {
  const isOk = result === 'ok' || result === 'ok_with_embedding_disabled';
  const isError = result === 'error';
  const color = isError
    ? 'text-destructive bg-destructive/10'
    : isOk
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
      : 'text-muted-foreground bg-muted/40';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] ${color}`}>
      {result}
    </span>
  );
}