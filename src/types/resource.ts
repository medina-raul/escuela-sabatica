export type ResourceType =
  | "pdf"
  | "ppt"
  | "audio"
  | "video"
  | "article"
  | "commentary"
  | "guide";

export type ResourceRole =
  | "general-reading"
  | "friday-reading"
  | "teacher-reading"
  | "weekly-presentation"
  | "daily-audio";

export type ResourceSource =
  | {
      kind: "url";
      url: string;
      allowedContentTypes?: string[];
      maxBytes?: number;
      etag?: string;
      lastModified?: string;
      provider?: string;
      providerUrl?: string;
    }
  | { kind: "manual" };

export type Resource = {
  id: string;
  type: ResourceType;
  title: string;
  description?: string;
  url: string;
  duration?: string;
  fileSize?: string;
  thumbnail?: string;
  external?: boolean;
  role: ResourceRole;
  lessonNumber?: number;
  dayId?: string;
  storage: "local" | "external";
  checksum?: string;
  sizeBytes?: number;
  source: ResourceSource;
};

export type AudioDiscoveryConfig = {
  urlTemplate: string;
  lessonStart: number;
  lessonEnd: number;
  dayTokens: Record<string, string>;
  allowedContentTypes: string[];
  maxBytes: number;
};

export type PresentationDiscoveryConfig = {
  indexUrl: string;
  fileNamePattern: string;
  year: number;
  quarter: number;
  lessonStart: number;
  lessonEnd: number;
  localUrlTemplate: string;
  allowedContentTypes: string[];
  maxBytes: number;
  indexMaxBytes: number;
  provider: string;
  providerUrl: string;
};

export type ResourceAutomationConfig = {
  schemaVersion: number;
  manifestPath: string;
  allowedSourceHosts: string[];
  maxDownloadBytes: number;
  audioDiscovery?: AudioDiscoveryConfig;
  presentationDiscovery?: PresentationDiscoveryConfig;
};

export type AudioResource = {
  title: string;
  url: string;
  duration?: string;
  narrator?: string;
};
