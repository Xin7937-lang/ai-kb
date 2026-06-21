// /settings/tags — manage tag order, hierarchy, and creation.
//
// Server-rendered tag list handed off to the `TagManagementList`
// client component.

import { FAVORITES_TAG_NAME, DEFAULT_TAGS } from '@/lib/notes/constants';
import { listTagsWithCount } from '@/lib/notes/queries';
import { TagManagementList } from './_components/tag-management-list';

export const dynamic = 'force-dynamic';

export default function TagsSettingsPage() {
  const tags = listTagsWithCount();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">标签管理</h2>
        <p className="text-sm text-muted-foreground">
          管理两级标签体系。默认标签：{DEFAULT_TAGS.join('、')}。
          「{FAVORITES_TAG_NAME}」是内置收藏标签。新建标签或子标签后可拖动排序。
        </p>
      </div>
      <TagManagementList initialTags={tags} />
    </div>
  );
}
