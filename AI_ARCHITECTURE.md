# AI Project Assistant - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER INTERFACE                              │
│  /projects/create - Step 1: Basic Info                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ User types description
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              AIAssistant.tsx Component                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  [Sparkles Icon] AI Project Assistant                     │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ "Beach cleanup Saturday 9am at Santa Cruz..."      │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  [Generate Project Details Button]                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ POST /api/ai/parse-project
                              │ { prompt: "..." }
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         API Route: /api/ai/parse-project/route.ts                │
│         Runtime: Edge (Global Distribution)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  const result = streamText({                              │  │
│  │    model: 'google/gemini-2.0-flash-lite',                │  │
│  │    messages: [system, user],                              │  │
│  │    temperature: 0.3                                       │  │
│  │  })                                                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Authenticated request
                              │ (AI_GATEWAY_API_KEY)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Vercel AI Gateway                                   │
│  • Authentication & Rate Limiting                                │
│  • Request Routing & Load Balancing                              │
│  • Usage Tracking & Analytics                                    │
│  • Budget Management                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Forwarded to provider
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Google Gemini 2.0 Flash Lite API                         │
│  • Processes natural language prompt                             │
│  • Applies system instructions                                   │
│  • Generates structured JSON response                            │
│  • Returns: {title, location, description, eventType, ...}       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Streaming response
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Response Stream Processing                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Stream chunks:                                            │  │
│  │  0:"{\"title\"..."                                        │  │
│  │  0:"Beach Cleanup..."                                     │  │
│  │  0:"at Santa Cruz\""                                      │  │
│  │  Parse → fullText → JSON.parse → AIParseResult           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Parsed data object
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         handleAIDataApply(aiData)                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  if (aiData.title) updateBasicInfo('title', ...)          │  │
│  │  if (aiData.eventType) setEventType(...)                  │  │
│  │  if (aiData.schedule) {                                    │  │
│  │    switch(eventType) {                                     │  │
│  │      case 'oneTime':                                       │  │
│  │        updateOneTimeSchedule(...)                          │  │
│  │      case 'multiDay':                                      │  │
│  │        addMultiDayEvent() + updateMultiDaySchedule(...)   │  │
│  │      case 'sameDayMultiArea':                             │  │
│  │        addRole() + updateMultiRoleSchedule(...)           │  │
│  │    }                                                        │  │
│  │  }                                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Dispatch reducer actions
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Form State (useEventForm hook)                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  state: {                                                  │  │
│  │    basicInfo: { title, location, description, ... }       │  │
│  │    eventType: 'oneTime' | 'multiDay' | 'sameDayMultiArea' │  │
│  │    schedule: { ... }                                       │  │
│  │    verificationMethod, requireLogin, isPrivate             │  │
│  │  }                                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ State update triggers re-render
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Form UI Updates                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ✓ Title field: "Beach Cleanup at Santa Cruz"             │  │
│  │  ✓ Location field: "Santa Cruz Beach"                     │  │
│  │  ✓ Description: [Full AI-generated text]                  │  │
│  │  ✓ Event type radio: "One-Time Event" selected            │  │
│  │  ✓ Date picker: [Next Saturday]                           │  │
│  │  ✓ Start time: 09:00                                       │  │
│  │  ✓ End time: 12:00                                         │  │
│  │  ✓ Volunteers: 20                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  [Toast: "Project details filled! Review and adjust..."] ✅      │
│  [AI Assistant auto-closes]                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Summary

1. **User Input** → Natural language description
2. **Client** → POST to `/api/ai/parse-project`
3. **Edge Runtime** → Calls Vercel AI Gateway
4. **AI Gateway** → Routes to Gemini 2.0 Flash Lite
5. **AI Model** → Generates structured JSON
6. **Stream** → Chunks returned to client
7. **Parser** → Assembles and parses JSON
8. **Handler** → Applies data to form reducer
9. **State** → Updates via reducer actions
10. **UI** → Re-renders with populated fields

## Component Interaction

```
ProjectCreator
    │
    ├─── showAIAssistant (state)
    │
    ├─── handleAIDataApply (callback)
    │         │
    │         ├─── updateBasicInfo()
    │         ├─── setEventType()
    │         ├─── updateOneTimeSchedule()
    │         ├─── updateMultiDaySchedule() + addMultiDayEvent() + addMultiDaySlot()
    │         ├─── updateMultiRoleSchedule() + addRole()
    │         └─── updateVerificationMethod()
    │
    └─── AIAssistant (component)
              │
              ├─── prompt (state)
              ├─── isProcessing (state)
              │
              ├─── handleGenerate()
              │         │
              │         ├─── fetch('/api/ai/parse-project')
              │         ├─── stream reader
              │         ├─── JSON parser
              │         └─── onApplyData(parsedData)
              │
              └─── UI (card, textarea, button)
```

## Security Layers

```
┌────────────────┐
│  User Browser  │
└────────┬───────┘
         │ HTTPS
         ▼
┌────────────────────┐
│  Edge Runtime API  │ ← Input validation
└────────┬───────────┘
         │ Authenticated (API Key)
         ▼
┌────────────────────┐
│  Vercel AI Gateway │ ← Rate limiting, budget controls
└────────┬───────────┘
         │ Provider auth
         ▼
┌────────────────────┐
│  Gemini API        │ ← Model safety filters
└────────┬───────────┘
         │ Structured output
         ▼
┌────────────────────┐
│  Zod Validation    │ ← Schema enforcement
└────────┬───────────┘
         │ Sanitized data
         ▼
┌────────────────────┐
│  Profanity Filter  │ ← Content moderation
└────────────────────┘
```

## Error Handling Flow

```
User Input
    │
    ▼
  Valid? ──NO──> Toast: "Please describe your project"
    │
   YES
    │
    ▼
API Call
    │
    ▼
Success? ──NO──> Toast: "Failed to parse. Try again."
    │                   │
   YES                  ▼
    │              Fallback: User fills manually
    ▼
Parse JSON
    │
    ▼
Valid JSON? ──NO──> Try extract with regex
    │                      │
   YES                    FAIL
    │                      │
    ▼                      ▼
Apply to Form      Toast: Error + Manual mode
    │
    ▼
Validation
    │
    ▼
Pass Zod? ──NO──> Errors shown inline (existing flow)
    │
   YES
    │
    ▼
Success! Continue to next step
```

## Performance Optimization

```
┌─────────────────┐
│  Edge Runtime   │ → Global distribution (low latency)
└─────────────────┘

┌─────────────────┐
│  Streaming      │ → Progressive rendering
└─────────────────┘

┌─────────────────┐
│  Gemini Flash   │ → Fast, lightweight model
└─────────────────┘

┌─────────────────┐
│  Caching        │ → AI Gateway caches similar prompts
└─────────────────┘

Result: ~2-3 second response time
```

## Cost Optimization

```
Model: Gemini 2.0 Flash Lite (cheapest tier)
Tokens: ~20-300 per request
Cost: < $0.0001 per project creation
Monthly (1000 projects): < $0.10

Gateway Benefits:
• Unified billing
• Budget alerts
• Rate limiting
• Automatic retries
• Load balancing
```

---

**Architecture Status**: ✅ Production Ready
**Last Updated**: 2025-10-23
