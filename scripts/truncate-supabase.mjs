import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

// Load .env.local manually (no dotenv dependency) if present and vars are not already set.
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key] && value) {
      process.env[key] = value;
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Supabase URL and SUPABASE_SERVICE_ROLE_KEY are required to truncate tables. Check your .env.local." );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function wipe(table) {
  const primaryKeyByTable = {
    message_bodies: "message_id",
  };

  const pk = primaryKeyByTable[table] || "id";

  // Use a dummy != filter on the primary key so every row is matched, including null-safe tables.
  const { error } = await supabase.from(table).delete().neq(pk, "00000000-0000-0000-0000-000000000000");
  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
  console.log(`Cleared ${table}`);
}

async function main() {
  await wipe("message_bodies");
  await wipe("user_message_states");
  await wipe("messages");
  await wipe("newsletter_sources");
  await wipe("sender_rules");
  await wipe("email_accounts");
  await wipe("sync_jobs");
  console.log("Supabase tables truncated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
