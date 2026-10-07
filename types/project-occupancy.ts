export type ProjectOccupancyRpcArgs = {
  p_project_ids: string[];
  p_viewer_id?: string | null;
  p_organization_id?: string | null;
};

export type ProjectOccupancyRpcRow = {
  project_id: string;
  slots_filled: number;
  slots_filled_by_schedule: Record<string, number>;
};
