// /settings/general -- customizable app title and other general look-and-feel.

import { getAppTitle, getChatRetrieveLimit, getChatWebSearchEnabled } from '@/lib/auth/init';
import { GeneralSettingsForm } from './_components/general-settings-form';

export const dynamic = 'force-dynamic';

export default function GeneralSettingsPage() {
  const title = getAppTitle();
  const chatRetrieveLimit = getChatRetrieveLimit();
  const chatWebSearchEnabled = getChatWebSearchEnabled();
  return (
    <div className="space-y-4">
      <GeneralSettingsForm
        initialTitle={title}
        initialChatRetrieveLimit={chatRetrieveLimit}
        initialChatWebSearchEnabled={chatWebSearchEnabled}
      />
    </div>
  );
}
