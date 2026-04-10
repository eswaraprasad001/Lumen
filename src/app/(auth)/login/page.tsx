import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { TestLoginForm } from "@/components/test-login-form";
import { getCurrentUser } from "@/lib/data";
import { appEnv } from "@/lib/env";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const testMode = appEnv.enableTestLogin;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Lumen" width={72} height={72} className="login-logo" />
          <h1>Lumen</h1>
          <p>A quiet workspace for newsletters, shaped around return and continuity.</p>
        </div>

        <div className="login-divider" />

        <div className="login-sso">
          {testMode ? <TestLoginForm /> : <GoogleSignInButton />}
        </div>

        <p className="login-hint">
          {testMode
            ? "Test mode — email/password login is enabled."
            : "Your session stays active until you sign out or it expires."}
        </p>
      </div>
    </div>
  );
}
