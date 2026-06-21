import { listSearchProviders, getActiveSearchProvider, getAllProviderConfigs } from '@/lib/search';
import { SearchSettingsForm } from './_components/search-settings-form';

export const dynamic = 'force-dynamic';

export default function SearchSettingsPage() {
  const providers = listSearchProviders();
  const activeProvider = getActiveSearchProvider();
  const configs = getAllProviderConfigs();

  return (
    <div className="space-y-4">
      <SearchSettingsForm
        initialProviders={providers}
        initialActiveProvider={activeProvider}
        initialConfigs={configs}
      />
    </div>
  );
}
