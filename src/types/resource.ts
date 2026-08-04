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
      credit?: string;
      currentChecksum?: string;
    }
  | {
      kind: "manual";
      inboxPath?: string;
      lastImportedChecksum?: string;
      maxBytes?: number;
      provider?: string;
      providerUrl?: string;
      credit?: string;
    };

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
  translation?: {
    sourceLanguage: "en";
    targetLanguage: "es";
    method: "manual" | "assisted-translation";
    sourceChecksum: string;
    detectedSourceChecksum?: string;
    producer?: string;
    model?: string;
    workflowVersion?: string;
    rendererVersion?: string;
    reviewStatus: "reviewed-existing" | "pending-review" | "reviewed" | "source-changed";
    generatedAt?: string;
  };
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

export type TeacherReadingDiscoveryConfig = {
  sourceUrlTemplate: string;
  sourceQuarter: string;
  lessonStart: number;
  lessonEnd: number;
  localUrlTemplate: string;
  allowedContentTypes: string[];
  maxBytes: number;
  maxOutputBytes: number;
  provider: string;
  providerUrl: string;
  credit: string;
  reviewRequired: boolean;
};

export type ResourceAutomationConfig = {
  schemaVersion: number;
  manifestPath: string;
  allowedSourceHosts: string[];
  maxDownloadBytes: number;
  canonicalLayout?: {
    roleTemplates: Partial<Record<ResourceRole, string>>;
    legacySearchRoots: string[];
  };
  manualInbox?: {
    path: string;
    descriptorSuffix: string;
    requireDescriptorForNew: boolean;
  };
  audioDiscovery?: AudioDiscoveryConfig;
  presentationDiscovery?: PresentationDiscoveryConfig;
  teacherReadingDiscovery?: TeacherReadingDiscoveryConfig;
};

export type AudioResource = {
  title: string;
  url: string;
  duration?: string;
  narrator?: string;
};
