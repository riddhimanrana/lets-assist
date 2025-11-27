import { NextResponse } from 'next/server';
import { performAiModerationScan } from '@/app/admin/moderation/ai-scan-logic';

export async function GET(_request: Request) {
  try {
    const result = await performAiModerationScan();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
