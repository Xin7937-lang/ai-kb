// /settings/agent -- experimental agent-tools settings: master toggle
// and audit-history viewer. The /chat pipeline reads agent_tools_enabled
// on every request, so toggling here takes effect on the next turn.

import { getAgentToolsEnabled } from '@/lib/auth/init';

import { AgentSettings } from './_components/agent-settings';

export const dynamic = 'force-dynamic';

export default function AgentSettingsPage() {
  const initialEnabled = getAgentToolsEnabled();
  return (
    <div className="space-y-4">
      <AgentSettings initialEnabled={initialEnabled} />
    </div>
  );
}