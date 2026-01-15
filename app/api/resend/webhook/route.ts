import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET is not configured." },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured." },
      { status: 400 },
    );
  }

  const payload = await req.text();
  const signature = req.headers.get("svix-signature");
  const timestamp = req.headers.get("svix-timestamp");
  const id = req.headers.get("svix-id");

  if (!signature || !timestamp || !id) {
    return NextResponse.json({ error: "Missing webhook headers." }, { status: 400 });
  }

  const resend = new Resend(apiKey);

  try {
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id,
        timestamp,
        signature,
      },
      webhookSecret,
    });

    if (event.type === "email.received") {
      console.info("Resend inbound email received:", {
        emailId: event.data?.email_id,
        from: event.data?.from,
        subject: event.data?.subject,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Invalid Resend webhook:", error);
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }
}
