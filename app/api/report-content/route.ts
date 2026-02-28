import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { notifyAdminsBatched } from '@/services/admin-notifications';
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { logError, logInfo, flushLogs } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get authenticated user using getClaims() for better performance
    const { user } = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in to report content.' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const { contentType, contentId, reason, description, url, metadata } = body;
    
    // Validate required fields
    if (!contentType || !contentId || !reason || !description) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Validate content type
    const validContentTypes = ['project', 'profile', 'comment', 'image', 'organization', 'other'];
    if (!validContentTypes.includes(contentType)) {
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 400 }
      );
    }
    
    // Validate reason
    const validReasons = [
      'spam',
      'harassment',
      'inappropriate_content',
      'misinformation',
      'copyright',
      'privacy_violation',
      'violence',
      'hate_speech',
      'other',
    ];
    if (!validReasons.includes(reason)) {
      return NextResponse.json(
        { error: 'Invalid report reason' },
        { status: 400 }
      );
    }
    
    // Validate description length
    if (description.trim().length < 10) {
      return NextResponse.json(
        { error: 'Description must be at least 10 characters' },
        { status: 400 }
      );
    }
    
    if (description.length > 1000) {
      return NextResponse.json(
        { error: 'Description must be less than 1000 characters' },
        { status: 400 }
      );
    }
    
    // Build enhanced description with URL and metadata
    let enhancedDescription = description.trim();
    if (url || metadata) {
      const details: string[] = [enhancedDescription];
      
      if (url) {
        details.push(`\n\nContent URL: ${url}`);
      }
      
      if (metadata) {
        if (metadata.title) details.push(`\nContent Title: ${metadata.title}`);
        if (metadata.creator) details.push(`\nContent Creator: ${metadata.creator}`);
        if (metadata.context) details.push(`\nContext: ${metadata.context}`);
        if (metadata.reportedAt) details.push(`\nReported at: ${metadata.reportedAt}`);
      }
      
      enhancedDescription = details.join('');
    }
    
    // Determine priority based on reason
    const highPriorityReasons = ['violence', 'hate_speech'];
    const priority = highPriorityReasons.includes(reason) ? 'high' : 'normal';
    
    // Insert the report into content_reports table
    const { data, error } = await supabase
      .from('content_reports')
      .insert({
        reporter_id: user?.id || null, // Allow anonymous reports
        content_type: contentType,
        content_id: contentId,
        reason: reason,
        description: enhancedDescription,
        status: 'pending',
        priority: priority,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) {
      logError('Failed to insert content report', error, {
        reporter_id: user?.id,
        content_type: contentType,
        content_id: contentId,
        reason,
      });
      
      after(async () => {
        await flushLogs();
      });
      
      return NextResponse.json(
        { error: 'Failed to submit report' },
        { status: 500 }
      );
    }
    
    try {
      await notifyAdminsBatched({
        type: 'content_report',
        reportId: data.id,
        reason,
        contentType,
        priority,
      });
    } catch (notifError) {
      logError('Failed to send admin notification for content report', notifError, {
        report_id: data.id,
        content_type: contentType,
        reason,
      });
      // Don't fail the request if notification fails
    }
    
    logInfo('Content report submitted successfully', {
      report_id: data.id,
      reporter_id: user?.id,
      content_type: contentType,
      content_id: contentId,
      reason,
      priority,
    });
    
    after(async () => {
      await flushLogs();
    });
    
    return NextResponse.json({
      success: true,
      reportId: data.id,
      message: 'Report submitted successfully',
    });
    
  } catch (error) {
    logError('Unexpected error in report-content API', error);
    
    after(async () => {
      await flushLogs();
    });
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
