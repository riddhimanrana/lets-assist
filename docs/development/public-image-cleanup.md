# Public image cleanup

Avatar and organization-logo changes reserve durable cleanup work before
uploading or changing a reference. The reservation binds the actor, owner,
previous URL and a new object key. The database checks current ownership and
active membership. A stale expected URL returns HTTP 409.

## Object lifecycle

Each replacement uses a new WebP key. The old image remains available until its
reference changes. Failed or unconfirmed uploads leave a reservation that can
be reconciled later. Organization deletion reserves its owned logo before the
organization row disappears.

The cleanup worker claims one object at a time. It retains any object referenced
by a profile, organization or Auth avatar/picture. Indexed reference lookups
avoid scanning those tables on every claim. Auth references live in a private
hash index maintained by a transactional trigger and deleted with the account.

Reference writes and cleanup claims lock the same object records. A retired
object key cannot be attached again or receive new Storage metadata. A claim
has a two-minute lease. The acknowledgement must match its token and expiry;
a lost response or failed delete remains eligible for reconciliation.

Completed cleanup removes the object path from the queue. The bucket, hashed
object identity and lifecycle metadata remain as a tombstone that prevents key
reuse. Historical objects without reservations are outside this worker's scope.
Do not delete tombstones or infer that an old object is unused from its age.

## Worker operation

`GET` and `POST /api/cron/public-image-cleanup` require an exact Bearer value
matching `CRON_TOKEN` or `CRON_SECRET`. Authenticated probes do not execute work.
The worker runs only when `PUBLIC_IMAGE_CLEANUP_ENABLED=true`; it is disabled
by default and this change adds no schedule.

One invocation claims at most ten objects within a 25-second work budget. Each
Storage request has an eight-second limit; claim and acknowledgement requests
have two-second limits. The route has a 60-second execution limit.

The response and [worker-health receipt](worker-health.md) contain counts only.
Every claimed object has exactly one result: deleted, retained, retryable or
failed. An invalid claim or an unconfirmed claim request fails the invocation.
Raw paths, user identities and provider diagnostics do not enter the receipt.

Before hosted activation, accept the integrated schema and application, verify
the target environment, configure a schedule and test independent missed-run
alerts. Confirm real deletion and retention using fictional owned images.
Observe pending age and repeated failures through an authorized operator path.
A successful HTTP response alone does not establish a healthy schedule.

## Storage recovery boundary

Storage can write backend bytes before committing object metadata. If an upload
finishes after cleanup retires its key, the metadata trigger refuses it. Storage
then owns recovery of those failed-upload bytes. A database queue receipt does
not prove that this separate provider recovery has finished.

Local acceptance at source `275bb712` used Storage 1.67.20 and PostgREST 14.15.
It proved normal upload/readback/deletion, retention by Auth-only references,
Auth account cleanup, a late upload refused after retirement, and actual
disappearance of the late upload's backend file. The held-upload test called
Storage inside the owned container because the local gateway buffers bodies.
Concurrent reference attachment and cleanup refusal also passed. The fixture
made no external requests.

The migration passed 52 focused pgTAP assertions. The image unit suites passed
56 tests and 239 assertions. A fictional indexed lookup with 2,000 profiles,
2,000 organizations and 4,000 Auth keys used six shared buffers in 0.047 ms.
These measurements do not establish hosted latency or crash durability of the
hosted Storage recovery queue. The integrated fresh database and browser gates
remain required, including the organization authorization repair.
