import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function run() {
  const url = process.env.NEXT_PUBLIC_REMOTE_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_REMOTE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("Missing remote Supabase credentials in .env.local");
    return;
  }

  const client = createClient(url, key);

  const { data: orgs } = await client
    .from("organizations")
    .select("id, name, username, created_by");

  console.log("Remote Organizations:");
  console.log(JSON.stringify(orgs, null, 2));

  if (orgs) {
    for (const org of orgs) {
      const { data: members } = await client
        .from("organization_members")
        .select("id, role, user_id")
        .eq("organization_id", org.id);
      console.log(`Members for ${org.name} (${org.id}):`);
      console.log(JSON.stringify(members, null, 2));
    }
  }
}

run().catch(console.error);
