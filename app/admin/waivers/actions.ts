'use server';

import { getAdminClient } from '@/lib/supabase/admin';
import { mapCustomPlacementsForDb, mapDetectedFieldsForDb } from '@/lib/waiver/map-definition-input';
import { WaiverDefinition, WaiverBuilderDefinition } from '@/types/waiver-definitions';
import { checkSuperAdmin } from '../actions';

/**
 * Get all global waiver definitions (admin only)
 * Uses service-role client to bypass RLS
 */
export async function getGlobalWaiverDefinitions(): Promise<WaiverDefinition[]> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }
  
  const supabase = getAdminClient();
  
  const { data, error } = await supabase
    .from('waiver_definitions')
    .select(`
      *,
      signers:waiver_definition_signers(*),
      fields:waiver_definition_fields(*)
    `)
    .eq('scope', 'global')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  // @ts-ignore - Supabase types might not match exactly with our defined types if not auto-generated
  return data || [];
}

/**
 * Get the active global waiver definition
 * Uses service-role client to ensure reliability regardless of RLS
 * No admin check - this is called by non-admin server flows
 */
export async function getActiveGlobalWaiverDefinition(): Promise<WaiverDefinition | null> {
  const supabase = getAdminClient();
  
  const { data, error } = await supabase
    .from('waiver_definitions')
    .select(`
      *,
      signers:waiver_definition_signers(*),
      fields:waiver_definition_fields(*)
    `)
    .eq('scope', 'global')
    .eq('active', true)
    // Be deterministic even if multiple active rows exist.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching active global waiver definition:", error);
    return null;
  }

  // @ts-ignore
  return data ?? null;
}

/**
 * Create a new global waiver definition
 * Uses service-role client for all DB and storage operations
 */
export async function createGlobalWaiverDefinition(
  title: string,
  pdfFile: FormData,
  builderDefinition: WaiverBuilderDefinition
): Promise<{ success: boolean; definitionId?: string; error?: string }> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized' };
  }

  const supabase = getAdminClient();
  const file = pdfFile.get('file') as File;
  
  if (!file) {
      return { success: false, error: 'No PDF file provided' };
  }

  // 1. Upload PDF
  const timestamp = Date.now();
  const filePath = `global-definitions/${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  
  const { error: uploadError } = await supabase.storage
    .from('waivers')
    .upload(filePath, file);

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { data: { publicUrl } } = supabase.storage
    .from('waivers')
    .getPublicUrl(filePath);

  // 2. Determine version
  // Get max version for global scope
  const { data: maxVersionData } = await supabase
    .from('waiver_definitions')
    .select('version')
    .eq('scope', 'global')
    .order('version', { ascending: false })
    .limit(1)
    .single();
    
  const nextVersion = (maxVersionData?.version || 0) + 1;

  // 3. Create Definition
  const { data: definition, error: definitionError } = await supabase
    .from('waiver_definitions')
    .insert({
      scope: 'global',
      project_id: null,
      title: title,
      version: nextVersion,
      active: false, // Default to inactive
      pdf_storage_path: filePath,
      pdf_public_url: publicUrl,
      source: 'global_pdf',
      created_by: userId ?? null,
    })
    .select()
    .single();

  if (definitionError || !definition) {
    return { success: false, error: `Definition creation failed: ${definitionError?.message}` };
  }

  // 4. Create Signers
  const signersToInsert = builderDefinition.signers.map((signer) => ({
    waiver_definition_id: definition.id,
    role_key: signer.roleKey,
    label: signer.label,
    required: signer.required,
    order_index: signer.orderIndex,
  }));

  if (signersToInsert.length > 0) {
      const { error: signersError } = await supabase
        .from('waiver_definition_signers')
        .insert(signersToInsert);

      if (signersError) {
          // Cleanup?
          return { success: false, error: `Signers creation failed: ${signersError.message}` };
      }
  }

  // 5. Create Fields (detected + custom)
  const fieldsToInsert = [];

  type DetectedFieldMappingForDb = {
    fieldKey: string;
    fieldType: string;
    pageIndex: number;
    rect: { x: number; y: number; width: number; height: number };
    pdfFieldName: string;
    label: string;
    required: boolean;
    signerRoleKey?: string;
    meta?: Record<string, unknown> | null;
  };

  const detectedFieldMappings: DetectedFieldMappingForDb[] = [];
  for (const [fieldKey, mapping] of Object.entries(builderDefinition.fields.detected || {})) {
    const pageIndex = mapping.pageIndex;
    const rect = mapping.rect;

    if (
      typeof pageIndex !== 'number' ||
      !rect ||
      typeof rect.x !== 'number' ||
      typeof rect.y !== 'number' ||
      typeof rect.width !== 'number' ||
      typeof rect.height !== 'number'
    ) {
      continue;
    }

    detectedFieldMappings.push({
      fieldKey: mapping.fieldKey || fieldKey,
      fieldType: mapping.fieldType || 'text',
      pageIndex,
      rect,
      pdfFieldName: mapping.pdfFieldName || fieldKey,
      label: mapping.label || mapping.fieldKey || fieldKey,
      required: mapping.required ?? false,
      signerRoleKey: mapping.signerRoleKey || undefined,
      meta: mapping.meta ?? null,
    });
  }

  const customPlacements = (builderDefinition.fields.custom || []).map((field) => ({
    id: field.id,
    fieldKey: field.fieldKey,
    label: field.label,
    fieldType: field.fieldType || 'signature',
    pageIndex: field.pageIndex,
    rect: field.rect,
    signerRoleKey: field.signerRoleKey,
    required: field.required,
    meta: field.meta ?? null,
  }));

  fieldsToInsert.push(...mapDetectedFieldsForDb(definition.id, detectedFieldMappings));
  fieldsToInsert.push(...mapCustomPlacementsForDb(definition.id, customPlacements));

  if (fieldsToInsert.length > 0) {
      const { error: fieldsError } = await supabase
        .from('waiver_definition_fields')
        .insert(fieldsToInsert);
        
      if (fieldsError) {
          return { success: false, error: `Fields creation failed: ${fieldsError.message}` };
      }
  }

  return { success: true, definitionId: definition.id };
}

/**
 * Activate a global waiver definition (deactivates others)
 * Uses service-role client for DB updates
 */
export async function activateGlobalWaiverDefinition(
  definitionId: string
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized' };
  }
  
  const supabase = getAdminClient();

  // Validate target exists and is global-scoped
  const { data: targetDefinition, error: targetError } = await supabase
    .from('waiver_definitions')
    .select('id')
    .eq('id', definitionId)
    .eq('scope', 'global')
    .single();

  if (targetError || !targetDefinition) {
    return { success: false, error: 'Global waiver definition not found' };
  }
  
  // Activate target definition first, then deactivate others.
  const { error: activateError } = await supabase
    .from('waiver_definitions')
    .update({ active: true })
    .eq('id', definitionId)
    .eq('scope', 'global');

  if (activateError) {
    return { success: false, error: activateError.message };
  }

  const { error: deactivateError } = await supabase
    .from('waiver_definitions')
    .update({ active: false })
    .eq('scope', 'global')
    .neq('id', definitionId);
  
  if (deactivateError) {
    return { success: false, error: deactivateError.message };
  }
  
  return { success: true };
}

/**
 * Delete a global waiver definition (with safety checks)
 * Uses service-role client for safety checks and deletion
 */
export async function deleteGlobalWaiverDefinition(
  definitionId: string
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized' };
  }
  
  const supabase = getAdminClient();

  // Validate target exists and is global-scoped
  const { data: targetDefinition, error: targetError } = await supabase
    .from('waiver_definitions')
    .select('id')
    .eq('id', definitionId)
    .eq('scope', 'global')
    .single();

  if (targetError || !targetDefinition) {
    return { success: false, error: 'Global waiver definition not found' };
  }
  
  // Check if any projects are explicitly linked to this definition (fallback users remain unaffected)
  // Actually, projects might not directly link to a *specific* global definition ID if they are using fallback.
  // They just have `waiver_definition_id = null`.
  // However, if we ever decided to "copy" a global definition to a project, that would be different.
  // But strictly, are there any dependent records?
  // Signatures might reference `waiver_definition_id`.
  
  const { count } = await supabase
    .from('waiver_signatures')
    .select('*', { count: 'exact', head: true })
    .eq('waiver_definition_id', definitionId);

  if (count && count > 0) {
      return {
          success: false,
            error: `Cannot delete: ${count} signature(s) have been collected with this waiver definition.`
      };
  }
  
  // Also check if any project EXPLICITLY links to this definition (unlikely given schema, but possible in future)
  const { count: projectCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('waiver_definition_id', definitionId);
  
  if (projectCount && projectCount > 0) {
    return {
      success: false,
      error: `Cannot delete: ${projectCount} project(s) are explicitly using this waiver definition.`
    };
  }
  
  // Delete (cascade will handle signers/fields)
  const { error } = await supabase
    .from('waiver_definitions')
    .delete()
    .eq('id', definitionId)
    .eq('scope', 'global');
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true };
}

/**
 * Update global waiver definition metadata
 * Uses service-role client for DB updates
 */
export async function updateGlobalWaiverDefinitionMetadata(
  definitionId: string,
  updates: { title?: string; }
): Promise<{ success: boolean; error?: string }> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized' };
  }
  
  const supabase = getAdminClient();
  
  const { error } = await supabase
    .from('waiver_definitions')
    .update(updates)
    .eq('id', definitionId)
    .eq('scope', 'global');
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true };
}
