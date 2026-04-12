export type PostHogTelemetryMetadata = Record<string, string | number | boolean | null | undefined>;

type CreatePostHogTelemetryOptions = {
  functionId: string;
  distinctId?: string;
  metadata?: PostHogTelemetryMetadata;
};

export function createPostHogTelemetry({
  functionId,
  distinctId,
  metadata = {},
}: CreatePostHogTelemetryOptions) {
  return {
    isEnabled: true,
    functionId,
    metadata: {
      ...metadata,
      ...(distinctId ? { posthog_distinct_id: distinctId } : {}),
    },
  };
}