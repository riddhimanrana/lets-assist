const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: orgs } = await supabase.from('organizations').select('id, name');
  console.log('Orgs:', orgs);

  for (const org of orgs) {
    const { data: profiles } = await supabase.schema('plugin_data').from('dv_sd_student_profiles').select('*').eq('organization_id', org.id);
    console.log(`Org ${org.name} - Student profiles count:`, profiles.length);
  }
}
run();
