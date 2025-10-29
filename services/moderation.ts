/**
 * Content Moderation Service
 * 
 * AI-powered content moderation for CIPA compliance.
 * Uses Vercel AI Gateway with Google Gemini 2.0 Flash Lite
 * 
 * Features:
 * - Automatic content filtering with AI
 * - Configurable severity thresholds
 * - Detailed logging for compliance
 * - User violation tracking
 * - Cost control via AI Gateway
 * - Centralized monitoring and analytics
 */

import { streamText } from 'ai';
import { createClient } from '@/utils/supabase/server';

// Model configuration for Vercel AI Gateway
const MODEL = 'google/gemini-2.0-flash-lite';

export interface ModerationResult {
  safe: boolean;
  flagged: boolean;
  categories: {
    sexual?: boolean;
    hate?: boolean;
    harassment?: boolean;
    'self-harm'?: boolean;
    'sexual/minors'?: boolean;
    'hate/threatening'?: boolean;
    'violence/graphic'?: boolean;
    violence?: boolean;
    inappropriate?: boolean;
  };
  category_scores: {
    [key: string]: number;
  };
  flagReason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  action: 'allowed' | 'flagged' | 'blocked' | 'review_required';
}

/**
 * Moderate image content using Vercel AI Gateway with Gemini Vision
 */
export async function moderateImage(imageUrl: string, userId?: string): Promise<ModerationResult> {
  try {
    let fullText = '';
    const result = streamText({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a content moderation system for a volunteer coordination platform used by schools and nonprofits. 
          Analyze images for inappropriate content including: violence, sexual content, hate speech, self-harm, harassment, or anything inappropriate for minors.
          Be strict but reasonable for a school environment. Return ONLY valid JSON with this structure:
          {
            "safe": boolean,
            "categories": {
              "sexual": boolean,
              "hate": boolean,
              "harassment": boolean,
              "self-harm": boolean,
              "sexual/minors": boolean,
              "hate/threatening": boolean,
              "violence/graphic": boolean,
              "violence": boolean,
              "inappropriate": boolean
            },
            "category_scores": {
              "sexual": 0.0-1.0,
              "hate": 0.0-1.0,
              "harassment": 0.0-1.0,
              "self-harm": 0.0-1.0,
              "violence": 0.0-1.0
            },
            "severity": "low" | "medium" | "high" | "critical",
            "reason": "brief explanation"
          }`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image for inappropriate content. Is it safe for a school/nonprofit volunteer platform?'
            },
            {
              type: 'image',
              image: imageUrl
            }
          ]
        }
      ],
      temperature: 0.2,
    });

    // Collect streamed response
    for await (const textPart of result.textStream) {
      fullText += textPart;
    }

    const analysis = JSON.parse(fullText);

    // Determine action based on severity
    let action: ModerationResult['action'] = 'allowed';
    if (analysis.severity === 'critical' || analysis.severity === 'high') {
      action = 'blocked';
    } else if (analysis.severity === 'medium') {
      action = 'review_required';
    } else if (!analysis.safe) {
      action = 'flagged';
    }

    const moderationResult: ModerationResult = {
      safe: analysis.safe,
      flagged: !analysis.safe,
      categories: analysis.categories || {},
      category_scores: analysis.category_scores || {},
      flagReason: analysis.reason,
      severity: analysis.severity,
      action,
    };

    // Log moderation result
    if (userId) {
      await logModeration({
        userId,
        contentType: 'image',
        contentId: imageUrl,
        result: moderationResult,
      });
    }

    return moderationResult;
  } catch (error) {
    console.error('Image moderation error:', error);
    // On error, fail safe - allow but flag for review
    return {
      safe: true,
      flagged: false,
      categories: {},
      category_scores: {},
      flagReason: 'Moderation service error - requires manual review',
      severity: 'low',
      action: 'review_required',
    };
  }
}

/**
 * Moderate text content using Vercel AI Gateway with Gemini
 */
export async function moderateText(text: string, userId?: string, contentId?: string): Promise<ModerationResult> {
  try {
    let fullText = '';
    const result = streamText({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a content moderation system for a volunteer coordination platform used by schools and nonprofits.
          Analyze text for inappropriate content including: violence, sexual content, hate speech, self-harm, harassment, profanity, or anything inappropriate for minors.
          Be strict but reasonable for a school environment. Return ONLY valid JSON with this structure:
          {
            "safe": boolean,
            "flagged": boolean,
            "categories": {
              "sexual": boolean,
              "hate": boolean,
              "harassment": boolean,
              "self-harm": boolean,
              "sexual/minors": boolean,
              "hate/threatening": boolean,
              "violence/graphic": boolean,
              "violence": boolean,
              "inappropriate": boolean
            },
            "category_scores": {
              "sexual": 0.0-1.0,
              "hate": 0.0-1.0,
              "harassment": 0.0-1.0,
              "self-harm": 0.0-1.0,
              "violence": 0.0-1.0
            },
            "severity": "low" | "medium" | "high" | "critical",
            "reason": "brief explanation if flagged"
          }`
        },
        {
          role: 'user',
          content: `Analyze this text for inappropriate content:\n\n"${text}"`
        }
      ],
      temperature: 0.2,
    });

    // Collect streamed response
    for await (const textPart of result.textStream) {
      fullText += textPart;
    }

    const moderation = JSON.parse(fullText);

    // Determine severity and action
    let severity: ModerationResult['severity'] = moderation.severity || 'low';
    let action: ModerationResult['action'] = 'allowed';
    const flaggedCategories: string[] = [];

    if (moderation.flagged) {
      const categories = moderation.categories;
      const scores = moderation.category_scores || {};

      // Check for critical violations
      if (categories['sexual/minors'] || categories['violence/graphic']) {
        severity = 'critical';
        action = 'blocked';
      } else if (categories['hate/threatening'] || scores.violence > 0.8) {
        severity = 'high';
        action = 'blocked';
      } else if (categories.harassment || categories.hate || scores.sexual > 0.7) {
        severity = 'medium';
        action = 'review_required';
      } else {
        severity = 'low';
        action = 'flagged';
      }

      // Collect flagged categories
      for (const [category, isFlagged] of Object.entries(categories)) {
        if (isFlagged) flaggedCategories.push(category);
      }
    }

    const moderationResult: ModerationResult = {
      safe: !moderation.flagged,
      flagged: moderation.flagged,
      categories: moderation.categories,
      category_scores: moderation.category_scores || {},
      flagReason: moderation.flagged ? (moderation.reason || `Flagged for: ${flaggedCategories.join(', ')}`) : undefined,
      severity,
      action,
    };

    // Log moderation result
    if (userId) {
      await logModeration({
        userId,
        contentType: 'text',
        contentId: contentId || text.substring(0, 50),
        result: moderationResult,
      });
    }

    return moderationResult;
  } catch (error) {
    console.error('Text moderation error:', error);
    // On error, fail safe - allow but flag for review
    return {
      safe: true,
      flagged: false,
      categories: {},
      category_scores: {},
      flagReason: 'Moderation service error - requires manual review',
      severity: 'low',
      action: 'review_required',
    };
  }
}

/**
 * Log moderation result to database
 */
async function logModeration({
  userId,
  contentType,
  contentId,
  result,
}: {
  userId: string;
  contentType: 'text' | 'image';
  contentId: string;
  result: ModerationResult;
}) {
  try {
    const supabase = await createClient();
    
    await supabase.from('moderation_logs').insert({
      user_id: userId,
      content_type: contentType,
      content_id: contentId,
      flagged: result.flagged,
      categories: result.categories,
      category_scores: result.category_scores,
      severity: result.severity,
      action: result.action,
      flag_reason: result.flagReason,
    });

    // If content is flagged or blocked, also add to flagged_content table
    if (result.action === 'blocked' || result.action === 'flagged' || result.action === 'review_required') {
      await supabase.from('flagged_content').insert({
        user_id: userId,
        content_type: contentType,
        content_id: contentId,
        severity: result.severity,
        categories: result.categories,
        reason: result.flagReason,
        status: result.action === 'blocked' ? 'blocked' : 'pending_review',
      });
    }
  } catch (error) {
    console.error('Failed to log moderation result:', error);
  }
}

/**
 * Get user violations count
 */
export async function getUserViolations(userId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from('flagged_content')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['blocked', 'confirmed']);
    
    return count || 0;
  } catch (error) {
    console.error('Failed to get user violations:', error);
    return 0;
  }
}
