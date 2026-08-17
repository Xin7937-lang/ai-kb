// /settings/agent -- experimental agent-tools settings: master toggle,
// audit-history viewer, and the LAN-agent bearer token manager. The
// /chat pipeline reads agent_tools_enabled on every request, so toggling
// here takes effect on the next turn.

import {
  getAgentToolsEnabled,
  getAgentApiTokenStatus,
  getAgentBatchEditDeleteEnabled,
} from '@/lib/auth/init';

import { AgentSettings } from './_components/agent-settings';
import { AgentApiTokenCard } from './_components/agent-api-token-card';

export const dynamic = 'force-dynamic';

export default function AgentSettingsPage() {
  const initialEnabled = getAgentToolsEnabled();
  const initialBatchEditDeleteEnabled = getAgentBatchEditDeleteEnabled();
  const initialApiToken = getAgentApiTokenStatus();
  return (
    <div className="space-y-4">
      <AgentSettings
        initialEnabled={initialEnabled}
        initialBatchEditDeleteEnabled={initialBatchEditDeleteEnabled}
      />
      <AgentApiTokenCard initialStatus={initialApiToken} />
    </div>
  );
}