const fs = require('fs');

function readPublishableKey() {
  for (const p of ['.env.local', '.env']) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=')) {
        return line
          .slice('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='.length)
          .replace(/^"|"$/g, '');
      }
    }
  }
  throw new Error('NO_PUBLISHABLE_KEY');
}

async function main() {
  const key = readPublishableKey();
  const base = 'https://api.lets-assist.com/rest/v1';
  const targets = [
    ['profiles', `${base}/profiles?select=id,email,phone&limit=3`],
    ['project_signups', `${base}/project_signups?select=*&limit=3`],
    ['anonymous_signups', `${base}/anonymous_signups?select=*&limit=3`],
    ['certificates', `${base}/certificates?select=*&limit=3`],
    ['organization_calendar_syncs', `${base}/organization_calendar_syncs?select=*&limit=3`],
    ['projects_public_check', `${base}/projects?select=id,title,visibility,workflow_status&limit=3`],
    ['organizations_public_check', `${base}/organizations?select=id,name&limit=3`],
  ];
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  const results = [];
  for (const [name, url] of targets) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    results.push({ name, status: res.status, body });
  }

  fs.writeFileSync('/tmp/lets-assist-live-api-probe.json', JSON.stringify(results, null, 2));
  console.log('LIVE_API_PROBE_READY');
}

main().catch((error) => {
  fs.writeFileSync('/tmp/lets-assist-live-api-probe.json', JSON.stringify({ error: String(error) }, null, 2));
  console.error(error);
  process.exit(1);
});
