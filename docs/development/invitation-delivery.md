# Invitation delivery

Bulk invitation, direct contact import, background contact import and explicit
resend share `lib/organization/invitation-delivery.ts`. The existing invitation
row holds the send intent before the provider call. A compare-and-swap on its
status, previous delivery state and previous attempt timestamp lets one request
claim an attempt. The provider idempotency key contains only the invitation ID
and its persisted attempt timestamp.

Only an accepted provider response, followed by a confirmed settlement write,
counts as a successful email. Skipped sends and known refusals remain unsent.
An ambiguous response, thrown request, process crash, or lost settlement leaves
the attempt unconfirmed. The server refuses another resend while that state is
unresolved. The existing invitation capability remains unchanged.

A delivery review uses the invitation ID, attempt time, deterministic provider
key and provider message metadata. Confirm the outcome before authorizing a new
attempt. An absent record in a partial log search is insufficient proof that no
message was accepted. This change does not automatically replay legacy pending
attempts or reset their delivery state. It does not add a mailbox-delivery claim:
provider acceptance can still be followed by a bounce.

The focused tests cover every transport outcome, send-before-settlement crash,
concurrent resend, database refusal and invitation acceptance or cancellation
racing the claim. Hosted acceptance and mailbox delivery remain release checks.
