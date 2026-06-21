// /settings/* layout. Renders a left-side sub-nav between Models and
// Account so the user can switch between config sections without a
// back-button.
//
// Active-link highlighting is delegated to the small `SettingsNav`
// client component below (it needs usePathname() to know which entry
// is active).

import { SettingsNav } from './_components/settings-nav';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">设置</h1>
      <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
        <aside>
          <SettingsNav />
        </aside>
        <section>{children}</section>
      </div>
    </div>
  );
}
