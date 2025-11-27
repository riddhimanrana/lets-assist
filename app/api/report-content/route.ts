import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Get authenticated user (optional - can allow anonymous reports)
    const { data: { user } } = await supabase.auth.getUser();
    
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
      console.error('Error inserting content report:', error);
      return NextResponse.json(
        { error: 'Failed to submit report' },
        { status: 500 }
      );
    }
    
    // Send notification to admins about new report (especially for high-priority reports)
    if (priority === 'high') {
      try {
        // TODO: Implement admin notification service
        // For now, just log high-priority reports
        console.warn(`HIGH-PRIORITY REPORT: ${reason} - Content ${contentId} (${contentType})`);
      } catch (notifError) {
        console.error('Error sending admin notification:', notifError);
        // Don't fail the request if notification fails
      }
    }
    
    return NextResponse.json({
      success: true,
      reportId: data.id,
      message: 'Report submitted successfully',
    });
    
  } catch (error) {
    console.error('Error in report-content API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
