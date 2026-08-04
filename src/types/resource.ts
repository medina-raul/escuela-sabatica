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

export type ResourceAutomationConfig = {
  schemaVersion: number;
  manifestPath: string;
  allowedSourceHosts: string[];
  maxDownloadBytes: number;
  audioDiscovery?: AudioDiscoveryConfig;
};

export type AudioResource = {
  title: string;
  url: string;
  duration?: string;
  narrator?: string;
};
