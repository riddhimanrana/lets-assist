import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    mode: process.env.E2E_TEST_MODE ? "e2e" : "default",
    timestamp: new Date().toISOString(),
  });
}
