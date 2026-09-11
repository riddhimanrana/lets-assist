import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  createRemoteReadonlyClient,
  type DevPreviewSource,
} from "@/lib/supabase/preview-source";

export type OrganizationReadModelRow = {
  id: string;
  username: string | null;
  name: string;
  description: string | null;
  website: string | null;
  logo_url: string | null;
  type: string;
  verified: boolean | null;
  created_at: string | null;
  show_members_publicly: boolean | null;
  public_member_count: number | null;
};

const PUBLIC_ORGANIZATION_FIELDS =
  "id,username,name,description,website,logo_url,type,verified,created_at,show_members_publicly,public_member_count";

// Share public metadata within this render only. Authorization uses fresh readers.
export const getPublicOrganizationForRender = cache(
  async (
    id: string,
    previewSource: DevPreviewSource,
  ): Promise<OrganizationReadModelRow | null> => {
    const client = await createClient();
    const readClient =
      previewSource === "remote"
        ? (createRemoteReadonlyClient() ?? client)
        : client;
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    const { data } = await readClient
      .from("organization_public_read_model")
      .select(PUBLIC_ORGANIZATION_FIELDS)
      .eq(isUUID ? "id" : "username", id)
      .single();
    return data as OrganizationReadModelRow | null;
  },
);
