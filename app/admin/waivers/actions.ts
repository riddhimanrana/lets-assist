'use server';

import { getAdminClient } from '@/lib/supabase/admin';
import type { WaiverDefinition } from '@/types/waiver-definitions';
import { checkSuperAdmin } from '../actions';

/** Read-only inventory; project managers edit waiver definitions in each project. */
export async function getProjectWaiverDefinitions(): Promise<WaiverDefinition[]> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await getAdminClient()
    .from('waiver_definitions')
    .select('*')
    .eq('scope', 'project')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as WaiverDefinition[];
}
