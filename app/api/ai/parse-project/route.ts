import { generateText } from 'ai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

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
  "isPrivate": boolean
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
- Default isPrivate to false unless explicitly mentioned
- Keep descriptions informative and engaging
- Extract location information carefully (city, state, address if provided)

Examples:
- "beach cleanup Saturday morning" → oneTime event, next Saturday at 9am-12pm (${new Date(new Date().getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} or later)
- "food drive Monday-Friday" → multiDay event spanning next 5 days starting ${new Date(new Date().getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
- "festival with registration booth and cleanup crew" → sameDayMultiArea with 2 roles on one day
- "tutoring sessions every Tuesday and Thursday" → multiDay with multiple slots per week

Return ONLY valid JSON, no additional text.`;

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const { text } = await generateText({
      model: 'google/gemini-2.5-flash-lite',
      system: systemPrompt,
      prompt,
      temperature: 0.3,
    });

    // Parse the JSON response
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsedData = JSON.parse(jsonMatch[0]);
      return Response.json(parsedData);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return Response.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('AI parsing error:', error);
    return Response.json(
      { error: 'Failed to parse project description' },
      { status: 500 }
    );
  }
}

