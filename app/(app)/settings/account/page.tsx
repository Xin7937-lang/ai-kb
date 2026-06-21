// /settings/account -- change login password + storage / recovery info.

import { ChangePasswordForm } from './_components/change-password-form';
import { PasswordStorageInfo } from './_components/password-storage-info';

export const dynamic = 'force-dynamic';

export default function AccountSettingsPage() {
  return (
    <div className="space-y-4">
      <ChangePasswordForm />
      <PasswordStorageInfo />
    </div>
  );
}
