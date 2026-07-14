import { generateText } from 'ai';
import { NextRequest } from 'next/server';
import { gatewayModel } from '@/lib/ai/gateway';
import { createPostHogTelemetry } from '@/lib/ai/posthog-telemetry';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { consumeParseProjectQuota } from '@/lib/ai/parse-project-rate-limit';
import { getRequestIp } from '@/lib/ai/parse-project-rate-limit-config';
import {
  normalizeParseProjectCandidate,
  parseProjectOutputSchema,
} from '@/lib/ai/parse-project-schema';
import { z } from 'zod';

// export const runtime = 'edge'; - incompatible with cacheComponents

const parseProjectRequestSchema = z
  .object({
    prompt: z.string().trim().min(10).max(4_000),
  })
  .strict();

const getCurrentDateInfo = () => {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0], // YYYY-MM-DD
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
  };
};

const systemPrompt = `You are an AI assistant that helps parse natural language descriptions of volunteering projects into structured data.

**IMPORTANT: Today's date is ${getCurrentDateInfo().date} (${getCurrentDateInfo().dayOfWeek}). All event dates MUST be in the future (today or later).**

Event Types Explained:
- "oneTime": A single event on one day with one time slot (e.g., "beach cleanup on Saturday 9am-12pm")
- "multiDay": An event spanning multiple days, each day can have multiple time slots (e.g., "conference Monday-Wednesday 9am-5pm each day" or "food drive Mon/Tue/Wed/Thu/Fri")
- "sameDayMultiArea": One day with multiple different roles/areas happening at the same time (e.g., "festival on Saturday with registration booth (9am-5pm), cleanup crew (2pm-5pm), food service (11am-3pm)")

Given a user's description, extract and return a JSON object with the following structure:
{
  "title": "string (max 125 chars)",
  "location": "string (max 250 chars)",
  "description": "string (max 2000 chars, detailed description)",
  "eventType": "oneTime" | "multiDay" | "sameDayMultiArea",
  "schedule": {
    // For oneTime:
    "date": "YYYY-MM-DD",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "volunteers": number
    
    // For multiDay (array of days):
    [
      {
        "date": "YYYY-MM-DD",
        "slots": [
          {
            "name": "string (optional, max 75 chars, descriptive slot label)",
            "startTime": "HH:MM",
            "endTime": "HH:MM",
            "volunteers": number
          }
        ]
      }
    ]
    
    // For sameDayMultiArea:
    {
      "date": "YYYY-MM-DD",
      "overallStart": "HH:MM",
      "overallEnd": "HH:MM",
      "roles": [
        {
          "name": "string (max 75 chars)",
          "startTime": "HH:MM",
          "endTime": "HH:MM",
          "volunteers": number
        }
      ]
    }
  },
  "verificationMethod": "qr-code" | "manual" | "auto" | "signup-only",
  "requireLogin": boolean,
  "recurrence": {
    "enabled": boolean,
    "frequency": "daily" | "weekly" | "monthly" | "yearly",
    "interval": number (default 1),
    "endType": "never" | "on_date" | "after_occurrences",
    "endDate": "YYYY-MM-DD" (only if endType is "on_date"),
    "endOccurrences": number (only if endType is "after_occurrences"),
    "weekdays": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] (only for weekly frequency)
  }
}

Rules:
- **CRITICAL: All dates must be in the future (today ${getCurrentDateInfo().date} or later). Never use past dates.**
- If no specific date is mentioned, suggest dates within 1-2 weeks from today (${getCurrentDateInfo().date})
- If a day of week is mentioned (e.g., "Saturday"), calculate the next occurrence of that day from today
- Default volunteers to reasonable numbers (10-50) unless specified
- For times, use reasonable defaults (9am-5pm for full day, 2-4 hours for shorter events)
- If multiple different roles or areas are mentioned happening at the same time on one day, use "sameDayMultiArea"
- If the same activity spans multiple days, use "multiDay"
- Otherwise use "oneTime"
- Default verificationMethod to "qr-code" for in-person events
- Default requireLogin to true
- Keep descriptions informative and engaging
- Extract location information carefully (city, state, address if provided)
- **For recurring events**: Set recurrence.enabled to true and populate the recurrence object
  - Keywords like "every", "weekly", "monthly", "daily" indicate recurring events
  - If specific days are mentioned (e.g., "every Tuesday and Thursday"), set frequency to "weekly" and add those days to weekdays array
  - If "every day" is mentioned, set frequency to "daily"
  - Default interval to 1 unless specified (e.g., "every 2 weeks" would be interval: 2)
  - Default endType to "never" unless a specific end date or number of occurrences is mentioned
  - For recurring events, still provide the schedule for the FIRST occurrence only
- **For multiDay events**: ALWAYS include a "slots" array for each day, even if there's only one slot
  - Example: [{"date": "2026-02-15", "slots": [{"name": "Morning Shift", "startTime": "09:00", "endTime": "17:00", "volunteers": 20}]}]
  - Never omit the slots array
  - If the user describes different shifts or activities within a multi-day event, include a descriptive "name" for each slot
  - If no slot label is obvious, leave "name" empty or omit it

Examples:
- "beach cleanup Saturday morning" → oneTime event, next Saturday at 9am-12pm, recurrence.enabled: false
- "food drive Monday-Friday" → multiDay event spanning next 5 days, recurrence.enabled: false
- "tutoring sessions every Tuesday and Thursday" → oneTime event on next Tuesday, with recurrence: {enabled: true, frequency: "weekly", weekdays: ["tuesday", "thursday"]}
- "weekly team meeting every Friday at 3pm" → oneTime event on next Friday, with recurrence: {enabled: true, frequency: "weekly", weekdays: ["friday"]}
- "monthly volunteering on the 15th" → oneTime event on next 15th, with recurrence: {enabled: true, frequency: "monthly"}
- "festival with registration booth and cleanup crew" → sameDayMultiArea with 2 roles on one day, recurrence.enabled: false

Return ONLY valid JSON, no additional text.`;

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getAuthUser({ sensitive: true });
    if (authError || !user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const requestBody = await req.json().catch(() => null);
    const parsedRequest = parseProjectRequestSchema.safeParse(requestBody);
    if (!parsedRequest.success) {
      return Response.json(
        { error: 'Project description must be between 10 and 4,000 characters.' },
        { status: 400 },
      );
    }

    const { prompt } = parsedRequest.data;
    let quota: Awaited<ReturnType<typeof consumeParseProjectQuota>>;
    try {
      quota = await consumeParseProjectQuota(user.id, getRequestIp(req.headers));
    } catch (rateLimitError) {
      console.error('Project parser rate-limit check failed:', rateLimitError);
      return Response.json(
        { error: 'Project assistant is temporarily unavailable. Please try again.' },
        { status: 503 },
      );
    }

    if (!quota.allowed) {
      const retryAfterSeconds = Math.max(
        Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1_000),
        1,
      );
      return Response.json(
        { error: 'Too many project-assistant requests. Please try again shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': retryAfterSeconds.toString() },
        },
      );
    }

    const { text } = await generateText({
      model: gatewayModel('platform', 'google/gemini-2.5-flash-lite'),
      experimental_telemetry: createPostHogTelemetry({
        functionId: 'parse-project',
        distinctId: user.id,
        metadata: {
          ai_feature: 'project-form-parser',
          prompt_length: prompt.length,
          rate_limit_remaining: quota.remaining,
        },
      }),
      system: systemPrompt,
      prompt,
      temperature: 0.3,
    });

    // Parse the JSON response
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('Project parser response did not contain JSON');
        return Response.json(
          { error: 'AI did not return valid JSON. Please try rephrasing your description.' },
          { status: 502 }
        );
      }
      
      const candidate = normalizeParseProjectCandidate(JSON.parse(jsonMatch[0]));
      const parsedData = parseProjectOutputSchema.safeParse(candidate);

      if (!parsedData.success) {
        console.error(
          'Project parser returned an invalid shape:',
          parsedData.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join('.'),
          })),
        );
        return Response.json(
          { error: 'AI response was incomplete. Please try rephrasing your description.' },
          { status: 502 },
        );
      }

      return Response.json(parsedData.data);
    } catch (parseError) {
      console.error('Project parser returned invalid JSON:', parseError);
      return Response.json(
        { error: 'Failed to parse AI response. Please try again or rephrase your description.' },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error('AI parsing error:', error);
    return Response.json(
      { error: 'Failed to process your request. Please try again.' },
      { status: 500 }
    );
  }
}
