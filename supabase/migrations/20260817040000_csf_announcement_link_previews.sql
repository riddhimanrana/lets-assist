-- Safe, immutable-at-publication metadata for the first external link in a
-- CSF announcement. The browser never fetches arbitrary metadata and public
-- loaders project only these bounded display fields.

CREATE UNIQUE INDEX IF NOT EXISTS csf_announcements_id_org_uidx
  ON plugin_data.csf_announcements(id, organization_id);

CREATE TABLE plugin_data.csf_announcement_link_previews (
  announcement_id uuid PRIMARY KEY
    REFERENCES plugin_data.csf_announcements(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
  description text CHECK (
    description IS NULL OR length(description) BETWEEN 1 AND 500
  ),
  site_name text CHECK (site_name IS NULL OR length(site_name) BETWEEN 1 AND 120),
  image_url text CHECK (image_url IS NULL OR length(image_url) BETWEEN 1 AND 2048),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_announcement_link_previews_announcement_org_fkey
    FOREIGN KEY (announcement_id, organization_id)
    REFERENCES plugin_data.csf_announcements(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX csf_announcement_link_previews_org_idx
  ON plugin_data.csf_announcement_link_previews(organization_id, fetched_at DESC);

ALTER TABLE plugin_data.csf_announcement_link_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_announcement_link_previews
  FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_announcement_link_previews TO service_role;

COMMENT ON TABLE plugin_data.csf_announcement_link_previews IS
  'Server-fetched, SSRF-screened display metadata for a published CSF announcement link. Public access is only through the dedicated safe projection.';
