import { SettingsPanel } from "@/components/settings-panel";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAuth } from "@/lib/auth";
import { getSettingsData } from "@/lib/data";

export default async function SettingsPage() {
  await requireAuth();
  const data = await getSettingsData();

  return (
    <>
      <section className="page-header">
        <div>
<h1>Connection, rules, and account.</h1>
        </div>
      </section>

      <SettingsPanel
        gmailConnected={data.gmailConnected}
        lastSyncAt={data.lastSyncAt}
        messageCount={data.messageCount}
        includeRuleCount={data.includeRuleCount}
        senderRules={data.senderRules}
        retentionDays={data.retentionDays}
        metadataRetentionDays={data.metadataRetentionDays}
        userEmail={data.userEmail}
        gmailEmail={data.gmailEmail}
        lastError={data.lastError}
        mode={data.mode}
        signOutButton={<SignOutButton />}
      />
    </>
  );
}
