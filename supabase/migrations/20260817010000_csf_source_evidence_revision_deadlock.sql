-- Scope the source-relative freshness refusal to reads the preview did not see.
--
-- `csf_refresh_sheet_source_evidence` refuses a commit when the file's provider
-- version moved while its modification time did not. It made that judgment
-- twice: once against the version the preview froze (correct, and unchanged
-- here) and once against `settings->>'evidenceRevision'`, the last read this
-- function itself accepted.
--
-- The second comparison could not be satisfied. Google advances a Drive file's
-- version counter for changes that never touch `modifiedTime`, so a workbook
-- that sat untouched between two imports arrived with a newer version and an
-- identical timestamp. The officer previewed it, reviewed the current rows, and
-- was refused -- and because only a successful run of this function writes
-- `evidenceRevision`, the refusal preserved the very disagreement it fired on.
-- The source deadlocked: every later commit failed with a message telling the
-- officer to preview again, which could not help. Hit live on the real c/o 2027
-- workbook after five tabs had imported cleanly.
--
-- The refusal now also requires this read to disagree with the version the
-- preview froze. A file that changed AFTER the officer reviewed it is still
-- refused by that unconditional check; a file that changed BEFORE the review,
-- and was reviewed in its current state, commits and re-blesses the record.

CREATE OR REPLACE FUNCTION plugin_data.csf_refresh_sheet_source_evidence(p_organization_id uuid, p_actor_user_id uuid, p_source_id uuid, p_preview_job_id uuid, p_expected_generation bigint, p_provider_file_id text, p_mime_type text, p_modified_time timestamp with time zone, p_provider_version text, p_trashed boolean, p_access_state text, p_file_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- Deliberately short. The token exists to prove the provider was read
  -- immediately before the claim, and a long-lived one would prove only that it
  -- was read at some point.
  c_token_ttl_seconds constant integer := 120;
  -- The one MIME a native Google Sheet has. Not a prefix, not a family.
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  -- Drive's `version` is documented as an int64. Canonical decimal text: no
  -- sign, no leading zero, no separators. A leading zero is refused rather than
  -- normalized because this value is only ever compared for exact equality, and
  -- `007` and `7` are the same integer but different evidence.
  c_version_shape constant text := '^[1-9][0-9]*$';
  -- The int64 ceiling, as text. Compared as text on purpose: with no leading
  -- zeros a shorter string is the smaller integer and equal lengths compare
  -- lexicographically in numeric order, so the bound holds with no cast to any
  -- numeric type -- the same rule the TypeScript reader applies, for the same
  -- reason that a double cannot carry this value.
  c_version_max constant text := '9223372036854775807';
  -- Padding DETECTION, never repair, and locale-INDEPENDENT. A provider answer
  -- with a stray space in its file id is not that file id, and `btrim`ing it
  -- into one made a padded answer compare equal to the frozen coordinate it is
  -- supposed to be checked against.
  --
  -- `[[:space:]]` was the previous detector and it is a LOCALE class that does
  -- not match U+0085, U+00A0 or U+200B at all, so this issuer and the readiness
  -- boundary disagreed about the same bytes. The code points are listed by
  -- number instead: Unicode White_Space, plus general categories Cc and Cf.
  -- U+0000 NUL is absent because PostgreSQL `text` cannot hold one -- the
  -- json/text input boundary refuses it before this function is reached.
  -- One shared, complete, locale-independent implementation. See
  -- `plugin_data.csf_has_edge_padding`.
  -- The same Drive-OUTPUT spelling the claim gate applies, checked before the
  -- frozen timestamp is cast: UTC `Z`, and a fraction of exactly 0, 3, 6 or 9
  -- digits. A frozen `+00:00`, `-00:00` or `.1234` is not provider output. The
  -- cast catches an impossible calendar date; it does NOT catch hour 24 or
  -- second 60, which PostgreSQL reads as the neighbouring instant.
  c_drive_instant constant text :=
    '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
    || 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]'
    || '(?:\.(?:[0-9]{3}|[0-9]{6}|[0-9]{9}))?Z$';
  -- The three digits BELOW the microsecond, captured so precision `timestamptz`
  -- cannot retain is refused rather than silently truncated into equality.
  c_drive_nanos constant text := '\.[0-9]{6}([0-9]{3})Z$';
  -- Bounds on the free-text provider strings this function stores. A provider
  -- that answers with a megabyte of "file name" is answering wrongly.
  c_max_file_id_length constant integer := 512;
  c_max_file_name_length constant integer := 1024;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_file_id text;
  v_file_name text;
  v_frozen_file_id text;
  v_frozen_version text;
  v_frozen_mime text;
  v_frozen_modified_text text;
  v_frozen_modified_at timestamptz;
  v_digest text;
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_preview_job_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF source evidence refresh must name the preview it is being issued for.'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_file_id IS NULL
    OR p_mime_type IS NULL
    OR p_modified_time IS NULL
    OR p_provider_version IS NULL
    OR p_trashed IS NULL
    OR p_access_state IS NULL
    OR p_file_name IS NULL
  THEN
    RAISE EXCEPTION
      'A CSF source evidence refresh needs complete provider evidence; null evidence is a refusal, not a value.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- The server-read provider answer, validated before anything is stored or
  -- compared. Every coordinate is checked for exactly the value the contract
  -- names -- not "present", not "looks about right".
  -- ------------------------------------------------------------------
  -- The file id is IDENTITY, so it is taken exactly as the provider sent it. A
  -- padded answer is rejected rather than canonicalized: `btrim` here repaired
  -- ` 1AbC ` into the id it was about to be compared with, so a wrong answer
  -- became a matching one on its way through the validator.
  v_file_id := nullif(p_provider_file_id, '');
  IF v_file_id IS NULL
    OR plugin_data.csf_has_edge_padding(v_file_id)
    OR length(v_file_id) > c_max_file_id_length
  THEN
    RAISE EXCEPTION
      'The provider did not identify this CSF source with a usable file id.'
      USING ERRCODE = '22023';
  END IF;
  -- The display provenance this refresh records. Bounded and required: a source
  -- the provider will not name is a source nothing can be attributed to.
  v_file_name := nullif(btrim(p_file_name), '');
  IF v_file_name IS NULL OR length(v_file_name) > c_max_file_name_length THEN
    RAISE EXCEPTION
      'The provider did not report a usable name for this CSF source.'
      USING ERRCODE = '22023';
  END IF;
  -- Exactly the Google Sheets MIME. This issuer proves a native Sheet; a Doc, a
  -- Form, a folder and an uploaded workbook are all "not this file".
  IF p_mime_type <> c_sheets_mime THEN
    RAISE EXCEPTION 'This CSF source is no longer a Google Sheet.' USING ERRCODE = '23514';
  END IF;
  -- The freshness coordinate a native Sheet actually exposes. Drive populates
  -- headRevisionId and content checksums only for binary Drive content, never
  -- for a Docs Editors file, so requiring one of those would be an impossible
  -- provider contract; `version` is the one that advances on every server-side
  -- change. A blank, signed, zero, leading-zero or over-long value is malformed
  -- evidence, and malformed evidence is a refusal. Read exactly, with no
  -- `btrim`: a padded version is refused rather than canonicalized into one that
  -- would then compare equal to the frozen coordinate it must be checked against.
  --
  -- `COLLATE "C"` on purpose: the bound is a comparison of DIGITS, and a
  -- database whose default collation reorders or equates characters would
  -- otherwise decide an int64 ceiling by locale rules that have nothing to do
  -- with numbers.
  IF p_provider_version !~ c_version_shape
    OR length(p_provider_version) > length(c_version_max)
    OR (length(p_provider_version) = length(c_version_max)
      AND p_provider_version COLLATE "C" > c_version_max COLLATE "C")
  THEN
    RAISE EXCEPTION
      'The provider did not report a usable version for this CSF source.'
      USING ERRCODE = '22023';
  END IF;
  -- `trashed` must be exactly SQL false, never null and never true. "Not stated"
  -- is not "not trashed". `access_state` must be exactly `accessible`.
  IF p_trashed IS NOT FALSE OR p_access_state <> 'accessible' THEN
    RAISE EXCEPTION 'This CSF source is not currently accessible, so its evidence cannot be refreshed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source.source_type
  );

  -- This issuer proves a GOOGLE file is unchanged. An uploaded workbook has no
  -- Drive object to re-read, and letting it through here would mean accepting
  -- caller-supplied "provider evidence" for a source whose evidence is supposed
  -- to come exclusively from locked database state.
  IF v_source.provider <> 'google_sheets' THEN
    RAISE EXCEPTION
      'This CSF source is not a Google source, so its evidence is issued from its staged workbook rather than a provider read.'
      USING ERRCODE = '23514';
  END IF;

  -- The preview this receipt will authorize, resolved and checked here rather
  -- than trusted. A receipt bound to a job that is not a preview, belongs to
  -- another organization, or was taken from a different source proves nothing
  -- about the rows the claim is about to commit.
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_preview.mode <> 'preview' THEN
    RAISE EXCEPTION 'CSF source evidence is issued against a preview run, not a commit run.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'That CSF preview was taken from a different source.'
      USING ERRCODE = '23514';
  END IF;

  -- Every frozen coordinate is read EXACTLY: the JSON type first, then the text
  -- as it stands with no `btrim`, then a padded value nulled into the existing
  -- missing-evidence refusal. Trimming it instead repaired a padded frozen id
  -- into one that compared equal to the live provider answer, which is the
  -- agreement these comparisons exist to establish rather than manufacture.
  v_frozen_file_id := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'id', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_file_id) THEN
    v_frozen_file_id := NULL;
  END IF;
  -- The JSON type is part of the coordinate, so it is required before the text.
  --
  -- `jsonb ->> 'version'` coerces the JSON number 58 into the text 58, which then
  -- passes the canonical int64 grammar below exactly as a genuine provider string
  -- would. Drive serializes `version` as a JSON string because an int64 does not
  -- survive a double, so a numeric frozen version has already lost the property
  -- the exact-equality contract depends on. A JSON number, boolean, object, array
  -- or null therefore resolves to NULL here and falls into the existing
  -- re-preview refusal rather than being compared.
  v_frozen_version := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'version') = 'string'
      THEN nullif(v_preview.source_file_metadata ->> 'version', '')
    ELSE NULL
  END;
  v_frozen_mime := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
    ELSE NULL
  END;
  IF plugin_data.csf_has_edge_padding(v_frozen_mime) THEN
    v_frozen_mime := NULL;
  END IF;
  v_frozen_modified_text := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'modifiedTime') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'modifiedTime', '')
    ELSE NULL
  END;

  -- ------------------------------------------------------------------
  -- The live read, compared against what the PREVIEW froze.
  --
  -- Everything below used to be compared against the source row -- that is,
  -- against the previous refresh -- which answers "has this file changed since
  -- the last time anybody looked", not "is this still the file the reviewed rows
  -- were read from". Those diverge exactly when it matters: a takeover or a
  -- retry re-refreshes, the source row moves forward with the file, and the
  -- stale preview commits against evidence that agrees with itself.
  --
  -- All four coordinates are REQUIRED and all four are compared
  -- unconditionally. Two of them -- the MIME and the modified time -- used to be
  -- compared only `IF ... IS NOT NULL`, which meant a preview that never froze
  -- one silently skipped that comparison and still received a receipt. A
  -- comparison that a missing value turns off is not a check; incomplete
  -- evidence is a refusal.
  -- ------------------------------------------------------------------
  IF v_frozen_file_id IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record which provider file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_mime IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record what kind of file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_modified_text IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_version IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record the provider version a commit must be checked against; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The frozen timestamp is provider text inside an immutable jsonb column, so
  -- its SHAPE is checked before it is parsed, and it is then parsed defensively:
  -- an unparseable one is missing evidence, never an exception escaping to the
  -- caller as a cast error.
  --
  -- The shape check is not redundant with the cast. PostgreSQL rejects an
  -- impossible calendar date -- February 30, a non-leap February 29, April 31 --
  -- but reads `24:00:00` as the next day's midnight and `:60` as the next
  -- minute, and accepts a timestamp with no timezone at all as local time. Each
  -- of those would have become an instant the provider never reported.
  --
  -- The shape now also decides PRECISION. `timestamptz` retains microseconds, so
  -- a frozen `.123456789Z` cast into it silently loses its last three digits and
  -- then compares EQUAL to a stored or live instant it does not name. Nine
  -- digits whose sub-microsecond part is not all zero are refused before the
  -- cast rather than truncated through it.
  v_frozen_modified_at := NULL;
  IF v_frozen_modified_text ~ c_drive_instant
    AND coalesce((regexp_match(v_frozen_modified_text, c_drive_nanos))[1], '000') = '000'
  THEN
    BEGIN
      v_frozen_modified_at := v_frozen_modified_text::timestamptz;
    EXCEPTION WHEN others THEN
      v_frozen_modified_at := NULL;
    END;
  END IF;
  IF v_frozen_modified_at IS NULL THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  -- The job column and the frozen metadata describe the same instant or the
  -- preview's own evidence disagrees with itself, which nothing downstream can
  -- resolve.
  IF v_preview.source_modified_at IS NULL
    OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_modified_at
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record when its source was last modified; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The identity chain, closed at its own end.
  --
  -- This issuer compared frozen-to-provider here and provider-to-live below, but
  -- never the JOB's own `source_file_id` -- so a preview whose column named one
  -- Drive file while its frozen metadata named another received a receipt, and
  -- every later comparison was against the frozen copy alone. The job column is
  -- read exactly, with no `btrim`: a padded value is malformed evidence rather
  -- than something to repair into agreement.
  IF nullif(v_preview.source_file_id, '') IS NULL
    OR plugin_data.csf_has_edge_padding(v_preview.source_file_id)
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record which provider file it read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_file_id IS DISTINCT FROM v_frozen_file_id THEN
    RAISE EXCEPTION 'This CSF preview was taken from a different file than the one it recorded.'
      USING ERRCODE = '23514';
  END IF;
  IF v_file_id IS DISTINCT FROM v_frozen_file_id THEN
    RAISE EXCEPTION 'This CSF preview was taken from a different file than the provider now reports.'
      USING ERRCODE = '23514';
  END IF;
  IF p_mime_type IS DISTINCT FROM v_frozen_mime THEN
    RAISE EXCEPTION 'This CSF source is no longer the kind of file it was previewed as.'
      USING ERRCODE = '23514';
  END IF;
  -- Equal timestamp, different version. Checked against the preview's own
  -- frozen version, so it fires on the FIRST refresh of a source as well: the
  -- previous form compared against `settings->>'evidenceRevision'`, which is
  -- null until some refresh has already run, so the very case this guards --
  -- a file edited within one timestamp granule of the preview -- passed
  -- unexamined the first time through.
  IF p_modified_time = v_frozen_modified_at
    AND p_provider_version IS DISTINCT FROM v_frozen_version
  THEN
    RAISE EXCEPTION
      'This CSF source changed without its modification time advancing; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  -- Any other divergence from the reviewed snapshot, in either direction.
  IF p_modified_time IS DISTINCT FROM v_frozen_modified_at THEN
    RAISE EXCEPTION
      'This CSF source changed after it was previewed; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF p_provider_version IS DISTINCT FROM v_frozen_version THEN
    RAISE EXCEPTION
      'This CSF source''s contents moved on after it was previewed; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The compare-and-set. An older provider read carries the generation it saw
  -- before a concurrent refresh bumped it, so it lands here and is refused
  -- rather than overwriting newer evidence and receiving the newest token.
  IF p_expected_generation IS DISTINCT FROM v_source.evidence_generation THEN
    RAISE EXCEPTION
      'This CSF source was refreshed by another read while this one was in flight; run the check again.'
      USING ERRCODE = '40001';
  END IF;

  -- Identity, proved rather than assumed.
  IF v_file_id IS DISTINCT FROM coalesce(v_source.drive_file_id, v_source.spreadsheet_id) THEN
    RAISE EXCEPTION 'The provider answered about a different file than this CSF source names.'
      USING ERRCODE = '23514';
  END IF;

  -- Modification time may not go backwards. It is not an ordering signal on its
  -- own -- that is the generation CAS above -- but a regression means the read
  -- describes an older state of the file than one already accepted.
  IF v_source.drive_modified_at IS NOT NULL AND p_modified_time < v_source.drive_modified_at THEN
    RAISE EXCEPTION
      'The provider reports this CSF source was modified earlier than the evidence already on file; refusing to move it backwards.'
      USING ERRCODE = '23514';
  END IF;
  -- Equal modified time with a changed effective version is a conflict, not an
  -- update: the file changed within one timestamp granule, so the reviewed
  -- preview no longer describes it and a new preview is required.
  --
  -- This is the SOURCE-relative form of the same rule the preview-relative block
  -- above states. It is kept as well as, not instead of: it catches a source
  -- whose own last accepted evidence disagrees with this read, which the
  -- preview-relative check cannot see. Because it depends on a previous refresh
  -- having stored `evidenceRevision`, it is silent on a first refresh -- which is
  -- exactly why the preview-relative check exists and why it is not conditional.
  IF v_source.drive_modified_at IS NOT NULL
    AND p_modified_time = v_source.drive_modified_at
    AND (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceRevision', '')
      ELSE NULL
    END) IS NOT NULL
    AND (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceRevision', '')
      ELSE NULL
    END) IS DISTINCT FROM p_provider_version
    -- ...but only while THIS read also disagrees with what the preview froze.
    --
    -- The source-level revision records the last read this function accepted,
    -- which may be older than the preview being committed. When the officer's
    -- own preview already observed the version this read sees, the change
    -- happened before the review, not after it: the reviewed rows describe the
    -- file as it now stands, and the stale source-level record is simply
    -- refreshed below. Refusing that case deadlocked the source outright --
    -- nothing but a successful refresh advances `evidenceRevision`, so the
    -- guard went on refusing the very call that would have cleared it, and
    -- "preview it again" could never help. The check the officer's review
    -- cannot make for itself is the one above: live disagreeing with the
    -- preview's own frozen version, which stays unconditional.
    AND p_provider_version IS DISTINCT FROM v_frozen_version
  THEN
    RAISE EXCEPTION
      'This CSF source changed without its modification time advancing; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  v_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'fileId', v_file_id,
        'mimeType', p_mime_type,
        -- `US`, not `MS`. The digest is what consumption re-checks, and `MS`
        -- renders only three fractional digits -- so two provider reads whose
        -- modification times differ by microseconds produced the SAME digest and
        -- a receipt could be spent against evidence it did not attest to. Every
        -- digit the typed column retained is serialized.
        'modifiedTime', to_char(p_modified_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        -- The provider version, not a second copy of the modification time. The
        -- digest is what consumption re-checks, so a coordinate that is absent
        -- here is a coordinate nothing downstream can notice changing.
        'version', p_provider_version,
        'trashed', p_trashed
      )),
      'UTF8'
    )),
    'hex'
  );

  UPDATE plugin_data.csf_sheet_sources
  SET evidence_generation = v_source.evidence_generation + 1,
      evidence_refreshed_at = v_now,
      drive_modified_at = p_modified_time,
      drive_mime_type = p_mime_type,
      drive_trashed = false,
      drive_access_state = 'accessible',
      drive_access_checked_at = v_now,
      -- Display provenance only. A rename is benign and must never block a
      -- commit, so it is recorded and nothing more -- the name is validated as
      -- bounded and nonempty above but is deliberately never compared against
      -- what the preview froze.
      --
      -- Note the conservative consequence, stated rather than papered over: the
      -- documented provider `version` advances on metadata-only changes too, so
      -- a rename between preview and commit CAN move the version and require a
      -- fresh preview. That is a re-preview, not a wrong import, and it is the
      -- direction to be wrong in.
      drive_file_name = v_file_name,
      settings = v_source.settings || jsonb_build_object(
        'evidenceRevision', p_provider_version,
        'evidenceDigest', v_digest
      ),
      updated_at = v_now
  WHERE id = p_source_id;

  INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
    organization_id, source_id, actor_user_id, preview_job_id, provider,
    evidence_generation, metadata_digest,
    provider_file_id, mime_type, modified_time, provider_version,
    access_checked_at, expires_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, p_preview_job_id, 'google_sheets',
    v_source.evidence_generation + 1, v_digest,
    v_file_id, p_mime_type, p_modified_time, p_provider_version, v_now,
    v_now + make_interval(secs => c_token_ttl_seconds)
  ) RETURNING * INTO v_token;

  RETURN jsonb_build_object(
    'evidenceToken', v_token.nonce,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_digest,
    'provider', 'google_sheets',
    'previewJobId', p_preview_job_id,
    'expiresAt', v_token.expires_at
  );
END;
$function$


