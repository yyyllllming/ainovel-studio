export interface ModelProviderPreset {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  baseUrl: string;
  defaultModel: string;
  modelSuggestions: string[];
  note?: string;
}

export const CUSTOM_PROVIDER_ID = "custom";

/**
 * OpenAI 兼容中转 preset。选中后 UI 会展示分组+搜索的模型选择器，
 * 并从 /v1/models 拉取完整列表。
 */
export const RELAY_PROVIDER_ID = "relay";

/**
 * 常见 OpenAI 兼容入口。第一个为默认，可按自己的中转改。
 * inferProviderIdFromBaseUrl 会依次匹配。
 */
export const RELAY_BASE_URLS = [
  "http://127.0.0.1:3000/v1",
] as const;

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: RELAY_PROVIDER_ID,
    label: "OpenAI 兼容中转",
    description:
      "任意 OpenAI-compatible 网关：New API、One API、vLLM、本地代理等，统一 /v1/chat/completions。",
    baseUrl: RELAY_BASE_URLS[0],
    defaultModel: "gpt-4o",
    modelSuggestions: [
      "gpt-4o",
      "gpt-4.1",
      "gpt-4o-mini",
      "claude-sonnet-4",
      "claude-opus-4",
      "gemini-2.5-pro",
      "deepseek-chat",
      "qwen-max",
    ],
    note: "Base URL 预填本地中转，换成你自己的网关地址并填写 API Key。点击「拉取模型」可获取全部可用模型列表。",
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: "自定义 / 本地模型",
    description: "任意 OpenAI-compatible relay、本地网关或自建代理。",
    baseUrl: "",
    defaultModel: "",
    modelSuggestions: [],
    note: "自定义模式下不会覆盖你的 Base URL 和模型名。",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek 官方 API，兼容 OpenAI SDK。",
    docsUrl: "https://api-docs.deepseek.com/",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
    note: "官方文档同时给出 https://api.deepseek.com 与 /v1 两种兼容写法。",
  },
];

export function getModelProviderPreset(providerId?: string) {
  return (
    MODEL_PROVIDER_PRESETS.find((preset) => preset.id === providerId) ??
    MODEL_PROVIDER_PRESETS[0]
  );
}

export function isRelayProvider(providerId?: string) {
  return providerId === RELAY_PROVIDER_ID;
}

export function inferProviderIdFromBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "").toLocaleLowerCase();
  if (!normalized) {
    return CUSTOM_PROVIDER_ID;
  }

  // 优先匹配 OpenAI 兼容中转的入口
  for (const relayBase of RELAY_BASE_URLS) {
    const candidate = relayBase.replace(/\/+$/, "").toLocaleLowerCase();
    if (normalized === candidate || normalized.startsWith(`${candidate}/`)) {
      return RELAY_PROVIDER_ID;
    }
  }

  for (const preset of MODEL_PROVIDER_PRESETS) {
    if (preset.id === CUSTOM_PROVIDER_ID || preset.id === RELAY_PROVIDER_ID || !preset.baseUrl) {
      continue;
    }
    const presetBase = preset.baseUrl.trim().replace(/\/+$/, "").toLocaleLowerCase();
    if (normalized === presetBase || normalized.startsWith(`${presetBase}/`)) {
      return preset.id;
    }
  }

  return CUSTOM_PROVIDER_ID;
}
