/**
 * The one place that answers "which mailbox does this platform send from".
 *
 * The same default sender literal was copied into `services/email-send.ts` and
 * `lib/projects/hours-publication-email-service.ts`, and a feature wanting its
 * own sender had nowhere to look one up. This module holds the default once and
 * lets a feature vary only the display name in front of it, so an organization
 * appears in an inbox as itself without a second address to configure.
 *
 * This module makes no claim about provider state. Sender verification is
 * normally a domain-level fact held at the provider, and whether any address
 * here is accepted for delivery is unverified by this code.
 *
 * `EMAIL_FROM` wins over the default, so an isolated or local run keeps the
 * address it is configured with and an organization sender built here follows
 * it. Only the display name is ever substituted.
 */

/** The platform default sender, used when `EMAIL_FROM` is unset. */
export const DEFAULT_PLATFORM_SENDER =
  "Let's Assist <projects@notifications.lets-assist.com>";

/** The product name shown in parentheses after an organization's own name. */
export const PLATFORM_SENDER_SUFFIX = "Let's Assist";

/**
 * The slice of the environment this module reads.
 *
 * The index signature is what makes `process.env` assignable: a type whose
 * properties are all optional is a "weak type", and TypeScript rejects
 * `ProcessEnv` against one on the grounds that they share no declared property.
 */
export type SenderEnvironment = {
  EMAIL_FROM?: string | undefined;
  [key: string]: string | undefined;
};

/** Everything after the `@` in a mailbox, lowercased, or null. */
function senderDomain(mailbox: string): string | null {
  const at = mailbox.lastIndexOf("@");
  if (at < 1 || at === mailbox.length - 1) return null;
  return mailbox.slice(at + 1).toLowerCase();
}

export type PlatformSender = {
  /** The whole `Name <mailbox>` header value. */
  header: string;
  /** The bare mailbox, lowercased. */
  mailbox: string;
  /** The display name, or null for a bare-address configuration. */
  displayName: string | null;
  /** The mailbox's domain, lowercased, or null if the value is unparseable. */
  domain: string | null;
};

/**
 * Split a `Name <mailbox>` header, or a bare mailbox, into its parts.
 *
 * Quotes around the display name are stripped because they are transport
 * syntax, not part of the name, and re-adding them is the caller's business.
 */
export function parsePlatformSender(value: string): PlatformSender {
  const header = value.trim();
  const bracketed = header.match(/^(.*)<([^<>]+)>\s*$/u);
  if (!bracketed) {
    const mailbox = header.toLowerCase();
    return {
      header,
      mailbox,
      displayName: null,
      domain: senderDomain(mailbox),
    };
  }
  const mailbox = bracketed[2].trim().toLowerCase();
  const displayName =
    bracketed[1]
      .trim()
      .replace(/^"(.*)"$/u, "$1")
      .trim() || null;
  return { header, mailbox, displayName, domain: senderDomain(mailbox) };
}

/**
 * The sender this deployment is configured to use.
 *
 * `EMAIL_FROM` wins so a local or isolated environment can point every message
 * at its own transport. A blank or whitespace-only value is treated as unset
 * rather than as an empty sender, which is the failure mode that produces mail
 * with no From line at all.
 */
export function resolvePlatformSender(
  environment: SenderEnvironment = process.env,
): PlatformSender {
  const configured = environment.EMAIL_FROM?.trim();
  return parsePlatformSender(
    configured && configured.length > 0 ? configured : DEFAULT_PLATFORM_SENDER,
  );
}

/** The `Name <mailbox>` header this deployment sends platform mail from. */
export function resolvePlatformSenderHeader(
  environment: SenderEnvironment = process.env,
): string {
  return resolvePlatformSender(environment).header;
}

const MAX_DISPLAY_NAME = 64;

/**
 * An organization's display name over the configured platform mailbox.
 *
 * The name is flattened and bounded first. A display name is a header field, so
 * control characters are removed rather than escaped. A name that is empty
 * after that, or that carries characters RFC 5322 would need a quoted-string
 * for, falls back to the platform sender: this function returns a header meant
 * to transport verbatim, and quoting an unusual name is not worth the risk of
 * emitting a malformed one.
 */
export function buildOrganizationSenderHeader(
  organizationName: string | null | undefined,
  environment: SenderEnvironment = process.env,
): string {
  const sender = resolvePlatformSender(environment);
  const flattened = (organizationName ?? "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !flattened ||
    flattened.length > MAX_DISPLAY_NAME ||
    /["<>@,;:\\[\]]/u.test(flattened)
  ) {
    return sender.header;
  }
  return `${flattened} (${PLATFORM_SENDER_SUFFIX}) <${sender.mailbox}>`;
}
