// /notes/new -- wraps the edit form in create mode.

import { listTagsWithCount } from '@/lib/notes/queries';
import { NoteEditForm } from '@/components/notes/note-edit-form';

export const dynamic = 'force-dynamic';

export default function NewNotePage() {
  // Pull existing tag names so the form's <datalist> can autocomplete as
  // the user types. Count is dropped here (the form only needs names).
  const tags = listTagsWithCount().map((t) => t.name);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">新建笔记</h1>
      <NoteEditForm mode={{ kind: 'create' }} suggestedTags={tags} />
    </div>
  );
}
