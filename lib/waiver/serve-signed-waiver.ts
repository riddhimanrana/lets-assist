import "server-only";

import { safeConsole } from "@/lib/safe-console";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import {
  SignedWaiverPdfError,
  generateSignedWaiverPdf,
  type PdfGenerationOptions,
} from "@/lib/waiver/generate-signed-waiver-pdf";
import {
  checkWaiverAccess,
  getContentDisposition,
  resolveWaiverContentType,
} from "@/lib/waiver/preview-auth-helpers";
import { loadWaiverSourcePdf } from "@/lib/waiver/source-pdf-loader";
import type { SignaturePayload } from "@/types/waiver-definitions";

/**
 * Serves one signed waiver for the preview and download routes. The two routes
 * differ only in `inline`, so the lookup, the access decision, and the
 * rendering live here once.
 */

type WaiverDefinitionForRender = PdfGenerationOptions["definition"];

interface WaiverSignatureRecord {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  waiver_pdf_url: string | null;
  waiver_pdf_storage_path: string | null;
  signature_payload: SignaturePayload | null;
  signature_file_url?: string | null; // DEPRECATED - column may not exist in schema
  signature_storage_path: string | null;
  signed_at: string | null;
  upload_storage_path: string | null;
  signature_text: string | null;
  waiver_definition_id: string | null;
  project_id: string;
  signup_id?: string | null;
  waiver_definition?:
    | (WaiverDefinitionForRender & {
        pdf_storage_path: string | null;
        pdf_public_url: string | null;
      })
    | null;
}

interface ProjectForAuth {
  creator_id: string | null;
  organization_id: string | null;
  can_be_managed_by_staff: boolean | null;
  waiver_pdf_storage_path: string | null;
  waiver_pdf_url: string | null;
  project_timezone: string | null;
}

type PostgrestErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

function asLowerErrorText(
  error: PostgrestErrorLike | null | undefined,
): string {
  return `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
}

function isMissingColumnSignatureFileUrlError(
  error: PostgrestErrorLike | null | undefined,
): boolean {
  if (!error) return false;
  const text = asLowerErrorText(error);
  return (
    (error.code === "42703" || text.includes("does not exist")) &&
    text.includes("signature_file_url")
  );
}

function isNoRowsError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error || error.code !== "PGRST116") return false;
  const text = asLowerErrorText(error);
  return text.includes("0 rows") || text.includes("no rows");
}

function isInvalidUuidError(
  error: PostgrestErrorLike | null | undefined,
): boolean {
  if (!error) return false;
  const text = asLowerErrorText(error);
  return (
    error.code === "22P02" ||
    text.includes("invalid input syntax for type uuid")
  );
}

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const MESSAGES = {
  notFound: "This signed waiver could not be found.",
  forbidden: "You do not have access to this signed waiver.",
  lookupFailed: "The signed waiver could not be loaded. Please try again.",
  fileMissing: "The signed waiver file is missing from storage.",
  sourceMissing:
    "The waiver document for this project is no longer available, so the signed copy cannot be created.",
  encryptedSource:
    "The waiver document for this project is password protected, so the signed copy cannot be created. Ask the organizer to upload a copy without a password.",
  unreadableSource:
    "The waiver document for this project could not be read, so the signed copy cannot be created.",
  renderFailed: "The signed waiver could not be created. Please try again.",
  needsMigration:
    "This signed waiver is stored in an older format and cannot be opened here.",
} as const;

/**
 * Every failure is a JSON body with a sentence a person can read. The preview
 * is also opened directly in an iframe or a new tab, where JSON would be shown
 * raw, so a document request gets the same sentence as a small static page.
 */
export function waiverFailureResponse(
  request: Request,
  inline: boolean,
  status: number,
  message: string,
): Response {
  const wantsDocument =
    inline && (request.headers.get("accept") ?? "").includes("text/html");

  if (!wantsDocument) {
    return Response.json(
      { error: message },
      { status, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }

  // `message` is always one of the fixed sentences above, never request data.
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Signed waiver unavailable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:32rem;text-align:center}h1{font-size:1.125rem;font-weight:600;margin:0 0 .5rem}p{margin:0;opacity:.75}</style></head><body><main role="alert"><h1>Signed waiver unavailable</h1><p>${escaped}</p></main></body></html>`;

  return new Response(body, {
    status,
    headers: {
      ...PRIVATE_RESPONSE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
}

/**
 * A record signed without a stored definition (or before definitions existed)
 * has one signer and no placements, so its signature is stamped at a fixed
 * position for the role the payload names.
 */
export function singleSignerDefinition(
  roleKey: string,
): WaiverDefinitionForRender {
  return {
    id: "synthetic-single-signer",
    fields: [
      {
        field_key: `${roleKey}_signature`,
        field_type: "signature",
        page_index: 0,
        rect: { x: 100, y: 650, width: 250, height: 60 },
        signer_role_key: roleKey,
      },
    ],
  };
}

const SIGNATURE_SELECT = `
      id,
      user_id,
      anonymous_id,
      waiver_pdf_url,
      waiver_pdf_storage_path,
      signature_payload,
      signature_storage_path,
      signed_at,
      upload_storage_path,
      signature_text,
      waiver_definition_id,
      project_id,
      signup_id,
      waiver_definition:waiver_definitions (
        id,
        pdf_storage_path,
        pdf_public_url,
        signers,
        fields
      )
    `.trim();

export async function serveSignedWaiver(
  request: Request,
  signatureId: string,
  { inline }: { inline: boolean },
): Promise<Response> {
  const fail = (status: number, message: string) =>
    waiverFailureResponse(request, inline, status, message);
  const adminClient = getAdminClient();
  const { user } = await getAuthUser();

  // 1. Load waiver signature record
  // Schema-tolerant query - try with signature_file_url first (legacy rows),
  // retry without it if column doesn't exist (postgres error 42703)
  let selectClause = `${SIGNATURE_SELECT},\n      signature_file_url`;

  let { data: signature, error: sigError } = await adminClient
    .from("waiver_signatures")
    .select(selectClause)
    .eq("id", signatureId)
    .single();

  if (isMissingColumnSignatureFileUrlError(sigError)) {
    selectClause = SIGNATURE_SELECT;
    const retry = await adminClient
      .from("waiver_signatures")
      .select(selectClause)
      .eq("id", signatureId)
      .single();
    signature = retry.data;
    sigError = retry.error;
  }

  const shouldAttemptSignupFallback =
    (!signature && !sigError) ||
    isNoRowsError(sigError) ||
    isInvalidUuidError(sigError);

  if (shouldAttemptSignupFallback) {
    // Compatibility fallback: sometimes clients pass signupId instead of signatureId.
    const fallback = await adminClient
      .from("waiver_signatures")
      .select(selectClause)
      .eq("signup_id", signatureId)
      .order("signed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    signature = fallback.data;
    sigError = fallback.error;
  }

  if (sigError) {
    if (isNoRowsError(sigError) || isInvalidUuidError(sigError)) {
      return fail(404, MESSAGES.notFound);
    }

    safeConsole.error("Database query error in preview route:", sigError);
    return fail(500, MESSAGES.lookupFailed);
  }

  if (!signature) {
    return fail(404, MESSAGES.notFound);
  }

  const typedSignature = signature as unknown as WaiverSignatureRecord;
  const resolvedSignatureId = typedSignature.id || signatureId;

  // 2. Check authorization. The record and its project are looked up from the
  // id alone. Nothing else the client sends is trusted.
  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .select(
      "creator_id, organization_id, can_be_managed_by_staff, waiver_pdf_storage_path, waiver_pdf_url, project_timezone",
    )
    .eq("id", typedSignature.project_id)
    .single();

  if (projectError && !isNoRowsError(projectError)) {
    safeConsole.error(
      "Database query error while loading project in preview route:",
      projectError,
    );
    return fail(500, MESSAGES.lookupFailed);
  }

  if (!project) {
    return fail(404, MESSAGES.notFound);
  }

  const typedProject = project as ProjectForAuth;

  // The membership row carries its status. checkWaiverAccess only honors an
  // explicitly active one, and a failed lookup refuses the request.
  let orgMember: { role: string | null; status: string | null } | null = null;
  if (typedProject.organization_id && user) {
    const { data, error: orgMemberError } = await adminClient
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", typedProject.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orgMemberError) {
      safeConsole.error(
        "Database query error while loading org membership in preview route:",
        orgMemberError,
      );
      return fail(500, MESSAGES.lookupFailed);
    }

    orgMember = data;
  }

  const url = new URL(request.url);
  const anonymousSignupIdParam = url.searchParams.get("anonymousSignupId");
  const anonymousTokenParam = url.searchParams.get("token");
  const { data: validatedAnonymousSignup } = anonymousSignupIdParam
    ? await getAnonymousSignupAccessRecord({
        anonymousSignupId: anonymousSignupIdParam,
        token: anonymousTokenParam,
        columns: "id",
      })
    : { data: null };

  const authResult = checkWaiverAccess({
    currentUserId: user?.id ?? null,
    signature: {
      user_id: typedSignature.user_id,
      anonymous_id: typedSignature.anonymous_id,
    },
    project: {
      creator_id: typedProject.creator_id,
      organization_id: typedProject.organization_id,
      can_be_managed_by_staff: typedProject.can_be_managed_by_staff,
    },
    orgMember,
    anonymousSignupIdParam,
    anonymousAccessValidated: !!validatedAnonymousSignup,
  });

  if (!authResult.hasPermission) {
    return fail(403, MESSAGES.forbidden);
  }

  const sourcePdfReference = {
    projectId: typedSignature.project_id,
    storagePath:
      typedSignature.waiver_pdf_storage_path ??
      typedSignature.waiver_definition?.pdf_storage_path ??
      typedProject.waiver_pdf_storage_path,
    legacyUrl:
      typedSignature.waiver_pdf_url ??
      typedSignature.waiver_definition?.pdf_public_url ??
      typedProject.waiver_pdf_url,
  };
  const hasSourcePdf = !!(
    sourcePdfReference.storagePath || sourcePdfReference.legacyUrl
  );

  // All signed evidence is stored in the private signature bucket.
  const storageResolver = async (path: string): Promise<ArrayBuffer> => {
    const { data, error } = await adminClient.storage
      .from("waiver-signatures")
      .download(path);

    if (error || !data) {
      throw new Error("Failed to download a signature asset");
    }

    return await data.arrayBuffer();
  };

  const fileResponse = (body: BodyInit, contentType: string) =>
    new Response(body, {
      headers: {
        ...PRIVATE_RESPONSE_HEADERS,
        "Content-Type": contentType,
        "Content-Disposition": getContentDisposition(
          inline,
          resolvedSignatureId,
          contentType,
        ),
      },
    });

  const renderStamped = async (
    definition: WaiverDefinitionForRender,
    signaturePayload: SignaturePayload,
  ): Promise<Response> => {
    if (!hasSourcePdf) {
      return fail(404, MESSAGES.sourceMissing);
    }

    try {
      const sourcePdfBytes = await loadWaiverSourcePdf(sourcePdfReference, {
        adminClient,
      });
      const pdfBuffer = await generateSignedWaiverPdf({
        sourcePdfBytes,
        definition,
        signaturePayload,
        storageResolver,
        timeZone: typedProject.project_timezone,
      });

      return fileResponse(new Uint8Array(pdfBuffer), "application/pdf");
    } catch (error) {
      if (error instanceof SignedWaiverPdfError) {
        return fail(
          422,
          error.code === "encrypted_source"
            ? MESSAGES.encryptedSource
            : MESSAGES.unreadableSource,
        );
      }

      safeConsole.error("PDF generation failed:", error);
      return fail(500, MESSAGES.renderFailed);
    }
  };

  // 3. Handle all signature formats with proper priority
  //    Priority 1: Uploaded full waiver (offline mode)
  //    Priority 2: Multi-signer signature_payload (online mode with PDF generation)
  //    Priority 3: Legacy signature_storage_path (pre-migration draw/type signatures)
  //    Priority 4: Very old signature_file_url (ancient public URL format)
  //    Priority 5: Legacy signature_text (typed signature)

  // Priority 1: Uploaded full waiver (offline mode)
  if (typedSignature.upload_storage_path) {
    try {
      const { data, error } = await adminClient.storage
        .from("waiver-signatures")
        .download(typedSignature.upload_storage_path);

      if (error || !data) {
        safeConsole.error("Uploaded waiver file not found:", error);
        return fail(404, MESSAGES.fileMissing);
      }

      // A photo of a signed waiver is stored as an image. Its stored content
      // type decides both the header and the file extension.
      return fileResponse(
        data,
        resolveWaiverContentType(data.type, typedSignature.upload_storage_path),
      );
    } catch (error) {
      safeConsole.error("Error serving uploaded waiver:", error);
      return fail(500, MESSAGES.lookupFailed);
    }
  }

  // Priority 2: Multi-signer signature_payload. Every method (draw, typed, or
  // an uploaded signature image) is stamped onto the source PDF.
  const payload = typedSignature.signature_payload;
  const payloadSigners = Array.isArray(payload?.signers) ? payload.signers : [];
  if (payload && payloadSigners.length > 0) {
    // A project signed without a saved definition stored a single signer under
    // whatever role the signing form used. Render that one signature.
    const definition =
      typedSignature.waiver_definition ??
      singleSignerDefinition(payloadSigners[0].role_key);

    return renderStamped(definition, payload);
  }

  // Priority 3: Legacy signature_storage_path (pre-migration format)
  if (typedSignature.signature_storage_path) {
    return renderStamped(
      typedSignature.waiver_definition ?? singleSignerDefinition("participant"),
      {
        signers: [
          {
            role_key: "participant",
            method: "draw", // Legacy signatures are typically drawn
            data: typedSignature.signature_storage_path, // Storage path
            timestamp: typedSignature.signed_at || new Date().toISOString(),
          },
        ],
        fields: {},
      },
    );
  }

  // Priority 4: Very old signature_file_url format
  if (typedSignature.signature_file_url) {
    // Never turn historical database URLs into an open redirect. These rows
    // predate private evidence Storage and require an explicit migration.
    return fail(410, MESSAGES.needsMigration);
  }

  // Priority 5: Legacy signature_text format
  if (typedSignature.signature_text) {
    return renderStamped(
      typedSignature.waiver_definition ?? singleSignerDefinition("participant"),
      {
        signers: [
          {
            role_key: "participant",
            method: "typed",
            data: typedSignature.signature_text,
            timestamp: typedSignature.signed_at || new Date().toISOString(),
          },
        ],
        fields: {},
      },
    );
  }

  safeConsole.error("No signature data found for signature ID:", {
    signatureId: resolvedSignatureId,
  });
  return fail(404, MESSAGES.notFound);
}
