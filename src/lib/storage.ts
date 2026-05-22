// localStorage 读写 helpers。Provider 配置（含 API key）就存在这里。
// 注意：API key 保存在浏览器本地，只你自己电脑能看到。
// 以后如果部署到公网多人用，要改成每人自己登录后存自己的。

import type { ContentBlock, ProviderConfig } from "../providers";

const PROVIDERS_KEY = "cedar-chat.providers";
const CURRENT_KEY = "cedar-chat.current";
const PREFS_KEY = "cedar-chat.preferences";
const CONVERSATIONS_KEY = "cedar-chat.conversations";
const ACTIVE_CONVERSATION_KEY = "cedar-chat.activeConversation";
const AGENTS_KEY = "cedar-chat.agents";
const ACTIVE_AGENT_KEY = "cedar-chat.activeAgent";
const MCP_SERVERS_KEY = "cedar-chat.mcpServers";
const TTS_SETTINGS_KEY = "cedar-chat.ttsSettings";
const SYNC_SETTINGS_KEY = "cedar-chat.syncSettings";
const USER_STYLE_KEY = "cedar-chat.userStyle";

export interface CurrentSelection {
  providerId: string | null;
  model: string | null;
}

export interface Preferences {
  // 发请求时最多带多少条历史消息。"all" 表示不限。
  // 不含"当前这一条"，只算已经在对话里的历史。
  historyDepth: number | "all";
  chatFontSize: number;
}

export type TtsProviderKind = "elevenlabs" | "minimax" | "azure" | "edge";

export interface TtsProfile {
  id: string;
  name: string;
  provider: TtsProviderKind;
  apiKey: string;
  baseUrl: string;
  voice: string;
  model: string;
  region: string;
  groupId: string;
  outputFormat: string;
}

export interface TtsSettings {
  enabled: boolean;
  activeProfileId: string | null;
  profiles: TtsProfile[];
}

export type ClaudePromptCacheMode =
  | "off"
  | "agent-5m"
  | "agent-1h"
  | "context-5m"
  | "context-1h";
export type ClaudePromptCacheTTL = "off" | "5m" | "1h";

export type ThinkingEffort = "low" | "medium" | "high";
export type ThinkingMode = "effort" | "budget";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  model?: string | null;
  content: ContentBlock[];
  createdAt?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
}

export interface Agent {
  id: string;
  name: string;
  profile: string;
  memory: string;
  instructions: string;
  worldBook: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  agentId?: string | null;
  providerId: string | null;
  model: string | null;
  temperature: number;
  reasoningEnabled: boolean;
  thinkingMode: ThinkingMode;
  thinkingEffort: ThinkingEffort;
  thinkingBudgetTokens: number;
  agentPromptCache: ClaudePromptCacheTTL;
  contextPromptCache: ClaudePromptCacheTTL;
  claudePromptCache?: ClaudePromptCacheMode;
  showMessageTimestamps: boolean;
  injectCurrentTime: boolean;
  multiMessageEnabled: boolean;
  voiceMessagesEnabled: boolean;
  voiceMessageBudgetTokens: number;
  title: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  bearerToken: string;
  enabled: boolean;
}

export interface SyncSettings {
  endpoint: string;
  syncCode: string;
  deviceName: string;
  lastPushedAt: number | null;
  lastPulledAt: number | null;
  autoSyncEnabled: boolean;       // <-- 新增
  autoSyncIntervalMs: number;     // <-- 新增
}

const DEFAULT_PREFS: Preferences = {
  historyDepth: "all",
  chatFontSize: 18,
};

export function normalizeChatFontSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(14, Math.min(24, Math.round(value)))
    : DEFAULT_PREFS.chatFontSize;
}

function normalizePreferences(value: unknown): Preferences {
  if (!isRecord(value)) return DEFAULT_PREFS;
  const historyDepth =
    value.historyDepth === "all"
      ? "all"
      : typeof value.historyDepth === "number" && Number.isFinite(value.historyDepth)
        ? Math.max(0, Math.min(300, Math.round(value.historyDepth)))
        : DEFAULT_PREFS.historyDepth;
  return {
    historyDepth,
    chatFontSize: normalizeChatFontSize(value.chatFontSize),
  };
}

const DEFAULT_TTS_PROFILE: Omit<TtsProfile, "id"> = {
  name: "Browser voice",
  provider: "edge",
  apiKey: "",
  baseUrl: "",
  voice: "",
  model: "",
  region: "",
  groupId: "",
  outputFormat: "",
};

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  activeProfileId: null,
  profiles: [],
};

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  endpoint: "",
  syncCode: "",
  deviceName: "",
  lastPushedAt: null,
  lastPulledAt: null,
  autoSyncEnabled: false,         // <-- 新增
  autoSyncIntervalMs: 10_000,     // <-- 新增，默认30秒
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalizePreferences(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePreferences(prefs: Preferences): void {
  safeSetLocalStorage(PREFS_KEY, JSON.stringify(prefs));
}

export function loadUserStyle(): string {
  try {
    return localStorage.getItem(USER_STYLE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveUserStyle(style: string): void {
  safeSetLocalStorage(USER_STYLE_KEY, style);
}

export function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_KEY);
    if (!raw) return DEFAULT_TTS_SETTINGS;
    return normalizeTtsSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export function saveTtsSettings(settings: TtsSettings): void {
  safeSetLocalStorage(TTS_SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (!raw) return DEFAULT_SYNC_SETTINGS;
    return normalizeSyncSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SYNC_SETTINGS;
  }
}

export function saveSyncSettings(settings: SyncSettings): void {
  safeSetLocalStorage(SYNC_SETTINGS_KEY, JSON.stringify(normalizeSyncSettings(settings)));
}

export function newTtsProfileId(): string {
  return "tts_" + Math.random().toString(36).slice(2, 10);
}

export function createTtsProfile(
  patch: Partial<TtsProfile> = {},
): TtsProfile {
  return {
    id: newTtsProfileId(),
    ...DEFAULT_TTS_PROFILE,
    ...patch,
  };
}

export function getActiveTtsProfile(settings: TtsSettings): TtsProfile | null {
  return (
    settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings.profiles[0] ??
    null
  );
}

function normalizeTtsSettings(value: unknown): TtsSettings {
  if (!isRecord(value)) return DEFAULT_TTS_SETTINGS;

  if (Array.isArray(value.profiles)) {
    const profiles = value.profiles
      .map(normalizeTtsProfile)
      .filter((profile): profile is TtsProfile => Boolean(profile));
    const activeProfileId =
      typeof value.activeProfileId === "string" &&
      profiles.some((profile) => profile.id === value.activeProfileId)
        ? value.activeProfileId
        : (profiles[0]?.id ?? null);
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : false,
      activeProfileId,
      profiles,
    };
  }

  const legacyProfile = normalizeLegacyTtsProfile(value);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    activeProfileId: legacyProfile.id,
    profiles: [legacyProfile],
  };
}

function normalizeTtsProfile(value: unknown): TtsProfile | null {
  if (!isRecord(value)) return null;
  return createTtsProfile({
    id: typeof value.id === "string" ? value.id : newTtsProfileId(),
    name: typeof value.name === "string" && value.name.trim()
      ? value.name
      : "Voice profile",
    provider: normalizeTtsProvider(value.provider),
    apiKey: stringValue(value.apiKey),
    baseUrl: stringValue(value.baseUrl),
    voice: stringValue(value.voice),
    model: stringValue(value.model),
    region: stringValue(value.region),
    groupId: stringValue(value.groupId),
    outputFormat: stringValue(value.outputFormat),
  });
}

function normalizeLegacyTtsProfile(value: Record<string, unknown>): TtsProfile {
  return createTtsProfile({
    name: "Imported voice",
    provider: normalizeTtsProvider(value.provider),
    apiKey: stringValue(value.apiKey),
    baseUrl: stringValue(value.baseUrl),
    voice: stringValue(value.voice),
    model: stringValue(value.model),
    region: stringValue(value.region),
    groupId: stringValue(value.groupId),
    outputFormat: stringValue(value.outputFormat),
  });
}

function normalizeTtsProvider(value: unknown): TtsProviderKind {
  return value === "elevenlabs" ||
    value === "minimax" ||
    value === "azure" ||
    value === "edge"
    ? value
    : "edge";
}

function normalizeSyncSettings(value: unknown): SyncSettings {
  if (!isRecord(value)) return DEFAULT_SYNC_SETTINGS;
  return {
    endpoint: stringValue(value.endpoint),
    syncCode: stringValue(value.syncCode),
    deviceName: stringValue(value.deviceName),
    lastPushedAt:
      typeof value.lastPushedAt === "number" && Number.isFinite(value.lastPushedAt)
        ? value.lastPushedAt
        : null,
    lastPulledAt:
      typeof value.lastPulledAt === "number" && Number.isFinite(value.lastPulledAt)
        ? value.lastPulledAt
        : null,
    autoSyncEnabled:
      typeof value.autoSyncEnabled === "boolean" ? value.autoSyncEnabled : false,
    autoSyncIntervalMs:
      typeof value.autoSyncIntervalMs === "number" &&
      Number.isFinite(value.autoSyncIntervalMs)
        ? Math.max(10_000, Math.min(600_000, Math.round(value.autoSyncIntervalMs)))
        : 30_000,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadProviders(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(PROVIDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProviders(providers: ProviderConfig[]): void {
  safeSetLocalStorage(PROVIDERS_KEY, JSON.stringify(providers));
}

export function loadCurrent(): CurrentSelection {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (!raw) return { providerId: null, model: null };
    return JSON.parse(raw);
  } catch {
    return { providerId: null, model: null };
  }
}

export function saveCurrent(sel: CurrentSelection): void {
  safeSetLocalStorage(CURRENT_KEY, JSON.stringify(sel));
}

export function newProviderId(): string {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export function loadAgents(): Agent[] {
  try {
    const raw = localStorage.getItem(AGENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAgents(agents: Agent[]): void {
  safeSetLocalStorage(AGENTS_KEY, JSON.stringify(agents));
}

export function loadActiveAgentId(): string | null {
  return localStorage.getItem(ACTIVE_AGENT_KEY);
}

export function saveActiveAgentId(id: string | null): void {
  if (id) {
    safeSetLocalStorage(ACTIVE_AGENT_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_AGENT_KEY);
  }
}

export function newAgentId(): string {
  return "a_" + Math.random().toString(36).slice(2, 10);
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_SERVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  safeSetLocalStorage(MCP_SERVERS_KEY, JSON.stringify(servers));
}

export function newMcpServerId(): string {
  return "mcp_" + Math.random().toString(36).slice(2, 10);
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  safeSetLocalStorage(
    CONVERSATIONS_KEY,
    JSON.stringify(conversations.map(stripTransientConversationState)),
  );
}

export function loadActiveConversationId(): string | null {
  return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
}

export function saveActiveConversationId(id: string | null): void {
  if (id) {
    safeSetLocalStorage(ACTIVE_CONVERSATION_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  }
}

export function newConversationId(): string {
  return "c_" + Math.random().toString(36).slice(2, 10);
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not save ${key}.`, error);
  }
}

function stripTransientConversationState(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      content: stripTransientContentBlocks(message.content),
    })),
  };
}

function stripTransientContentBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map((block) => {
    if (block.type !== "voice") return block;
    if (block.status === "error") {
      return {
        type: "voice",
        id: block.id,
        text: block.text,
        status: "error",
        audioRef: block.audioRef,
        error: block.error,
      };
    }
    if (block.audioRef) {
      return {
        type: "voice",
        id: block.id,
        text: block.text,
        status: "ready",
        audioRef: block.audioRef,
      };
    }
    if (isPersistentAudioUrl(block.audioUrl)) {
      return {
        type: "voice",
        id: block.id,
        text: block.text,
        status: "ready",
        audioUrl: block.audioUrl,
      };
    }
    return {
      type: "voice",
      id: block.id,
      text: block.text,
    };
  });
}

function isPersistentAudioUrl(url: string | undefined): url is string {
  return Boolean(url?.startsWith("data:audio/"));
}
