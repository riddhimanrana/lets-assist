import type { NextRequest } from "next/server";
import { serveSignedWaiver } from "@/lib/waiver/serve-signed-waiver";

/**
 * Serves one signed waiver as a file download.
 *
 * The session (or the guest access token), the caller's right to this specific
 * record, and the rendering are all handled by serveSignedWaiver.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ signatureId: string }> },
) {
  const { signatureId } = await params;
  return serveSignedWaiver(request, signatureId, { inline: false });
}
