export interface PublicLlmProfile {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
}
