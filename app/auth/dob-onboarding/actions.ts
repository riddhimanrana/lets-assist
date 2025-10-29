'use server';

import { createClient } from '@/utils/supabase/server';
import { calculateAge, isUnder13 } from '@/utils/age-helpers';
import { getDefaultProfileVisibility, isInstitutionEmail } from '@/utils/settings/profile-settings';

export async function submitDOBOnboarding(userId: string, dateOfBirth: string) {
  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return { error: 'Unauthorized' };
    }

    // Get user's email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (!profile) {
      return { error: 'Profile not found' };
    }

    const email = profile.email || user.email || '';
    const isInstitution = await isInstitutionEmail(email);
    const age = calculateAge(dateOfBirth);

    // Validate age
    if (age < 5 || age > 120) {
      return { error: 'Please provide a valid date of birth' };
    }

    // Calculate settings based on age
    const profileVisibility = getDefaultProfileVisibility(dateOfBirth, isInstitution);
    const requiresParentalConsent = isUnder13(dateOfBirth);

    // Update profile with DOB and age-based settings
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        date_of_birth: dateOfBirth,
        age_verified_at: new Date().toISOString(),
        profile_visibility: profileVisibility,
        parental_consent_required: requiresParentalConsent,
        parental_consent_verified: !requiresParentalConsent,
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating profile:', updateError);
      return { error: 'Failed to update profile' };
    }

    return {
      success: true,
      requiresParentalConsent,
    };
  } catch (error) {
    console.error('Error in submitDOBOnboarding:', error);
    return { error: 'An unexpected error occurred' };
  }
}
