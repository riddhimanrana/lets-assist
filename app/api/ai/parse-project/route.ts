import { streamText } from 'ai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const systemPrompt = `You are an AI assistant that helps parse natural language descriptions of volunteering projects into structured data.

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
- If no specific date is mentioned, use dates in the near future (within 1-2 weeks)
- Default volunteers to reasonable numbers (10-50) unless specified
- For times, use reasonable defaults (9am-5pm for full day, 2-4 hours for shorter events)
- If multiple roles/areas are mentioned, use "sameDayMultiArea"
- If multiple days are mentioned, use "multiDay"
- Otherwise use "oneTime"
- Default verificationMethod to "qr-code" for in-person events
- Default requireLogin to true
- Default isPrivate to false unless explicitly mentioned
- Keep descriptions informative and engaging
- Extract location information carefully (city, state, address if provided)

Be intelligent about parsing context. For example:
- "beach cleanup Saturday morning" → oneTime event, Saturday at 9am-12pm
- "food drive Monday-Friday" → multiDay event with 5 days
- "festival with registration booth and cleanup crew" → sameDayMultiArea with 2 roles
- "tutoring sessions every Tuesday and Thursday" → multiDay with 2 days per week

Return ONLY valid JSON, no additional text.`;

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = streamText({
      model: 'google/gemini-2.0-flash-lite',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('AI parsing error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to parse project description' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
