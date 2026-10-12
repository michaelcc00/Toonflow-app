export type MediaProviderModel = {
  id: string;
  label: string;
  type: "text" | "image" | "video" | "audio";
  [key: string]: unknown;
};

export type CustomParamDef = {
  id: string;
  label: string;
  nodeId: string;
  fieldName: string;
  type: "switch" | "select" | "input" | "number";
  display?: "dropdown" | "tiles";
  defaultValue: string | number | boolean;
  options?: string[];
  visibleWhen?: { paramId: string; equals: string | number | boolean };
};

export type MediaProvider = {
  fileName: string;
  id: string;
  label: string;
  icon?: string;
  version?: string;
  readme?: string;
  modelsUrl?: string;
  rules?: Record<string, unknown>[];
  models: MediaProviderModel[];
  revision: string;
  loadError?: string;
};
