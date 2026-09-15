BEGIN;

CREATE INDEX csf_publication_notification_deliveries_org_idx
  ON plugin_data.csf_publication_notification_deliveries (organization_id, id);

COMMIT;
