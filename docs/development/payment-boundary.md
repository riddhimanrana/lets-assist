# Online payment disposition

The legacy Stripe adapter is retired. Current DV seasonal membership keeps its
manual payment requirements and staff-recorded payment state. Online Checkout,
Connect onboarding and refunds cannot be enabled by adding environment keys or
changing a plugin setting. Compatibility exports return an explicit unavailable
result before database or provider writes. They remain only until the private
legacy caller and public import contract can be removed together.

The October 7 audit follow-up read all 119 root Vercel environment metadata
records and the six child records. Neither project had a Stripe key name. This
supports the source evidence that the adapter is dormant; it does not prove that
no Stripe account, historical transaction or separately hosted integration exists.
No payment provider state was changed and no financial record was deleted.

The existing webhook URL verifies signed raw input when an endpoint secret is
configured, then returns 503 because this application cannot durably process the
event. Invalid signatures return 400. Missing configuration also returns 503.
It never acknowledges an unrecorded transition with HTTP 200. Provider retries
are finite, so any existing endpoint must be reconciled and disabled by its
owner rather than left retrying forever. Inspect provider event history before
choosing that disposition.

A future supported payment feature requires its own scoped design: server-side
actor and organization authorization; typed billing access; operation intent
before external creation; stable provider idempotency; immutable signed-event
receipts; atomic state and audit updates; order-safe refund and payment handling;
reconciliation of ambiguous provider outcomes; and synthetic database/provider
failure tests. Live activation follows the normal release authorization boundary.

Reference: [Stripe webhook delivery behavior](https://docs.stripe.com/webhooks#event-delivery-behaviors).
