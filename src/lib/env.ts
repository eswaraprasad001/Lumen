export const appEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  gmailRedirectUri:
    process.env.GMAIL_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/gmail/callback`,
  encryptionKey: process.env.APP_ENCRYPTION_KEY,
  retentionDays: Number(process.env.RETENTION_DAYS || "45"),
  metadataRetentionDays: Number(process.env.METADATA_RETENTION_DAYS || "90"),
  syncLookbackDays: Number(process.env.SYNC_LOOKBACK_DAYS || "60"),
  enableTestLogin: process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN === "true",
  // When true: skip all body/metadata pruning and the first-sync lookback cap.
  // Every synced message keeps its full body indefinitely.
  disableRetention: process.env.DISABLE_RETENTION === "true",
};

export function hasSupabaseConfig() {
  return Boolean(appEnv.supabaseUrl && appEnv.supabaseAnonKey);
}

export function hasAdminSupabaseConfig() {
  return Boolean(
    appEnv.supabaseUrl && appEnv.supabaseServiceRoleKey && appEnv.supabaseAnonKey,
  );
}

export function hasGmailConfig() {
  return Boolean(
    appEnv.googleClientId &&
      appEnv.googleClientSecret &&
      appEnv.gmailRedirectUri &&
      appEnv.encryptionKey,
  );
}
