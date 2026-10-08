# Account data exports

An export is a private archive of the account-owned datasets listed in its
manifest. It contains platform records, verified CSF profile records, and DV
records linked by account UUID or an authenticated submission. It does not claim
to contain every piece of data about a person.

Binary attachments and external files are excluded. The export includes owned
file metadata where available. Staff notes, other people's records, source
spreadsheets, security logs, credentials, and access links are excluded. Unlinked
historical records need the organization's identity and disclosure workflow;
matching an email address or name does not grant export access.

## Snapshot and scope

`account_data_export_snapshot` runs as one stable database statement, including
its Auth projection. Its 49 datasets use explicit columns. CSF records require
a verified account link in the same organization; DV student records require
the canonical user UUID. Legacy authenticated submissions and memberships have
separate datasets. Revoked and pending CSF links do not expose profile records.

Feedback includes submitted ratings and their context. Certificates include canonical
credited minutes and attendance revision. The attendance intervals dataset joins
only the account's own signups, with its own row and byte limits. Legacy awards
keep null canonical minutes until reviewed; the export does not invent a value
from their outer timestamps.

A preflight counts projected rows and their serialized byte sizes in that same
snapshot before JSON aggregation. Limits are 10,000 rows per dataset, 100,000
records in total, 40 MB of JSON, and 50 MB per ZIP. Queries and limits fail the
whole export. They never return a partial archive marked complete. The JSON
formatter also verifies every dataset name and count and applies credential-key
redaction to structured answers. Disabling redaction is refused.

## Requests and delivery

The Server Action requires fresh Auth and MFA validation. The service-only
request transaction resolves the current verified email address, takes the
account write lock, refuses pending removal, and reuses an active request or a
request made in the last 24 hours. Browsers can read their own history but cannot
insert jobs, choose delivery details, or invoke lifecycle RPCs.

Workers claim one job when ready to start it. A five-minute lease fences every
transition. Before upload, the worker persists the account/job/claim-derived
object path, SHA-256, size, and manifest. It never overwrites an object. After
upload it downloads the object and verifies its bytes. The ready transaction
independently checks Storage catalog existence and size. A later worker can
recover a confirmed upload without rebuilding the snapshot. Missing planned
objects can produce a new immutable attempt, while old receipts remain available
for cleanup. Unknown reads and digest mismatches fail closed.

Completed means the archive is ready. Email status is separate. The worker
persists a sending receipt before calling the provider, uses a stable idempotency
key, and records acceptance, skip, failure, or an unconfirmed outcome. Lost
acknowledgments and unknown sends are not automatically resent. The notification
contains the account page URL and actual expiry date. It has no attachment or
bearer download link.

Downloading requires fresh Auth and MFA validation again. The service verifies
the exact account, job, protocol, artifact path, and expiry before issuing a URL
valid for at most five minutes. History contains no stored download capability.

## Recovery and retention

An archive expires seven days after its upload plan was recorded. Each worker
pass considers at most ten expired artifact paths. It deletes through the
Storage API and independently confirms catalog absence before recording removal.
An expired archive awaiting notification becomes a terminal failed notification,
so it cannot consume worker slots indefinitely. A generation attempt that fails
waits twenty minutes before retrying; five attempts require operator review.

Legacy protocol-1 jobs are never automatically replayed. They may already have
sent mail without a receipt. Before adopting or replacing one, inspect the
provider and Storage evidence and record the decision. An unknown protocol-2
email also requires provider reconciliation. Do not reset sending to pending
because a client timed out. A new request after the cooldown creates a separate
archive with a separate delivery identity.

The archive lifecycle has a retention bound; job and audit receipt retention is
still governed by the account/audit retention program. No automatic deletion of
legacy archives or historical job evidence is introduced here.

## Rollout evidence

Deploy the forward database migrations before the paired application candidate.
Verify private bucket posture, RPC ACLs, subject isolation, metadata projection,
worker lease recovery, checksum verification, and fresh-auth downloads with
synthetic accounts. Run the snapshot/protocol pgTAP suites and the export unit
and UI suites on the integrated candidate. Inspect legacy pending/processing jobs
before enabling the scheduler: activation can send queued notification emails.
A local unit test does not prove the hosted scheduler is running.

Unit, caller, access, recovery and database protocol tests passed on the owned
local candidate. Integrated worker and browser acceptance remain pending. The
[cleanup register](cleanup-register.md) records current acceptance and release
status. Nothing here establishes a hosted or Production release.
