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
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  const probes = [
    {
      name: 'anonymous_signups_patch',
      url: `${base}/anonymous_signups?id=eq.4e5e8ff0-2c26-4cd8-b20c-99a99411b8ba`,
      method: 'PATCH',
      body: { name: 'Should Not Update' },
    },
    {
      name: 'project_signups_insert',
      url: `${base}/project_signups`,
      method: 'POST',
      body: {
        project_id: '5615342c-2add-4855-8701-f92a2552f680',
        schedule_id: 'rls-probe-slot',
        anonymous_id: '4e5e8ff0-2c26-4cd8-b20c-99a99411b8ba',
        status: 'pending',
      },
    },
  ];

  const results = [];
  for (const probe of probes) {
    const res = await fetch(probe.url, {
      method: probe.method,
      headers,
      body: JSON.stringify(probe.body),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    results.push({
      name: probe.name,
      status: res.status,
      body,
    });
  }

  fs.writeFileSync('/tmp/lets-assist-live-api-write-probe.json', JSON.stringify(results, null, 2));
  console.log('LIVE_API_WRITE_PROBE_READY');
}

main().catch((error) => {
  fs.writeFileSync('/tmp/lets-assist-live-api-write-probe.json', JSON.stringify({ error: String(error) }, null, 2));
  console.error(error);
  process.exit(1);
});
