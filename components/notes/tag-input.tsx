'use client';

// Tag editor for the note edit form. Replaces the old comma-separated
// textbox + datalist approach.
//
// UI:
//   - Current tags render as chips. Each chip shows a small X on hover
//     that removes the tag.
//   - A `<select>` dropdown lists every existing tag in the DB that
//     isn't already on this note. Picking one adds it.
//   - A text input + "+" button creates a new tag (Enter also works).
//     New tags are lowercased + deduped before being added.
//   - Empty state: just the dropdown + input, no chips.

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type TagInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  /** All existing tag names in the database. */
  suggestions: string[];
  disabled?: boolean;
};

export function TagInput({
  value,
  onChange,
  suggestions,
  disabled = false,
}: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [dropdownValue, setDropdownValue] = useState('');

  const available = useMemo(
    () => suggestions.filter((t) => !value.includes(t)),
    [suggestions, value],
  );

  function addTag(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;
    if (value.includes(normalized)) {
      setDraft('');
      return;
    }
    onChange([...value, normalized]);
    setDraft('');
  }

  function removeTag(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  function onDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (!v) return;
    addTag(v);
    // Reset the select so the same option can be picked again later
    // (useful when the user removes + re-adds the same tag in one session).
    setDropdownValue('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(draft);
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className={cn(
                'group inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground',
                'transition-colors',
              )}
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                aria-label={`删除标签 ${tag}`}
                title="删除标签"
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground',
                  'opacity-0 transition-opacity group-hover:opacity-100',
                  'hover:bg-destructive hover:text-destructive-foreground',
                  'focus-visible:opacity-100',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={dropdownValue}
          onChange={onDropdownChange}
          disabled={disabled || available.length === 0}
          aria-label="从已有标签选择"
          className={cn(
            'h-9 max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <option value="">
            {available.length === 0 ? '没有可添加的标签' : '从已有标签选择…'}
          </option>
          {available.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>

        <div className="flex min-w-[12rem] flex-1 items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="快速添加标签"
            disabled={disabled}
            aria-label="新建标签"
            className="flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => addTag(draft)}
            disabled={disabled || !draft.trim()}
            aria-label="添加标签"
            title="添加"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
