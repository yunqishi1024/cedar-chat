// Provider 设置抽屉
// - 左侧：已配置的 provider 列表
// - 右侧：当前编辑的 provider 表单
// - 可以新增 / 编辑 / 删除

import { useState } from "react";
import type { ProviderConfig, ProviderKind } from "../providers";
import {
  createTtsProfile,
  getActiveTtsProfile,
  newMcpServerId,
  newProviderId,
  type McpServerConfig,
  type Preferences,
  type SyncSettings,
  type TtsProfile,
  type TtsProviderKind,
  type TtsSettings,
} from "../lib/storage";
import { testMcpServer, type McpTestResult } from "../lib/mcp";
import { playTts } from "../lib/tts";

interface Props {
  open: boolean;
  activeTab: SettingsTab;
  providers: ProviderConfig[];
  preferences: Preferences;
  mcpServers: McpServerConfig[];
  ttsSettings: TtsSettings;
  syncSettings: SyncSettings;
  syncBusy: boolean;
  syncStatus: string | null;
  userStyle: string;                          // ← 新增
  onClose: () => void;
  onChange: (providers: ProviderConfig[]) => void;
  onActiveTabChange: (tab: SettingsTab) => void;
  onPreferencesChange: (prefs: Preferences) => void;
  onMcpServersChange: (servers: McpServerConfig[]) => void;
  onTtsSettingsChange: (settings: TtsSettings) => void;
  onSyncSettingsChange: (settings: SyncSettings) => void;
  onSyncPush: () => void;
  onSyncPull: () => void;
  onUserStyleChange: (style: string) => void; // ← 新增
}

export type SettingsTab = "providers" | "preferences" | "mcp" | "tts" | "sync";

function emptyConfig(): ProviderConfig {
  return {
    id: newProviderId(),
    name: "",
    kind: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    models: [],
  };
}

export function Settings({
  open,
  activeTab,
  providers,
  preferences,
  mcpServers,
  ttsSettings,
  syncSettings,
  syncBusy,
  syncStatus,
  userStyle,            // ← 新增
  onClose,
  onChange,
  onActiveTabChange,
  onPreferencesChange,
  onMcpServersChange,
  onTtsSettingsChange,
  onSyncSettingsChange,
  onSyncPush,
  onSyncPull,
  onUserStyleChange,    // ← 新增
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [modelsText, setModelsText] = useState("");

  if (!open) return null;

  function startEdit(p: ProviderConfig) {
    setEditingId(p.id);
    setDraft({ ...p });
    setModelsText(p.models.join("\n"));
  }

  function startNew() {
    const fresh = emptyConfig();
    setEditingId(fresh.id);
    setDraft(fresh);
    setModelsText("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setModelsText("");
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      alert("Name and Base URL are required");
      return;
    }
    const models = modelsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const finalDraft = { ...draft, models };

    const exists = providers.some((p) => p.id === finalDraft.id);
    const next = exists
      ? providers.map((p) => (p.id === finalDraft.id ? finalDraft : p))
      : [...providers, finalDraft];
    onChange(next);
    cancelEdit();
  }

  function deleteProvider(id: string) {
    if (!confirm("Delete this provider?")) return;
    onChange(providers.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 点击遮罩关闭 */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close settings"
      />

      {/* 抽屉本体 */}
      <div className="relative ml-auto flex h-full w-full max-w-3xl flex-col bg-white shadow-xl dark:bg-neutral-900">
        <header className="flex items-start justify-between gap-3 border-b border-neutral-200 px-3 py-3 dark:border-neutral-800 sm:items-center sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            <button
              onClick={() => onActiveTabChange("providers")}
              className={`px-3 py-1 rounded text-sm ${
                activeTab === "providers"
                  ? "bg-neutral-100 dark:bg-neutral-800 font-medium"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              Providers
            </button>
            <button
              onClick={() => onActiveTabChange("preferences")}
              className={`px-3 py-1 rounded text-sm ${
                activeTab === "preferences"
                  ? "bg-neutral-100 dark:bg-neutral-800 font-medium"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              Preferences
            </button>
            <button
              onClick={() => onActiveTabChange("tts")}
              className={`px-3 py-1 rounded text-sm ${
                activeTab === "tts"
                  ? "bg-neutral-100 dark:bg-neutral-800 font-medium"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              语音
            </button>
            <button
              onClick={() => onActiveTabChange("sync")}
              className={`px-3 py-1 rounded text-sm ${
                activeTab === "sync"
                  ? "bg-neutral-100 dark:bg-neutral-800 font-medium"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              同步
            </button>
            <button
              onClick={() => onActiveTabChange("mcp")}
              className={`px-3 py-1 rounded text-sm ${
                activeTab === "mcp"
                  ? "bg-neutral-100 dark:bg-neutral-800 font-medium"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              MCP
            </button>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Close ✕
          </button>
        </header>

        {activeTab === "preferences" ? (
          <PreferencesPanel
            preferences={preferences}
            userStyle={userStyle}
            onChange={onPreferencesChange}
            onUserStyleChange={onUserStyleChange}
          />
        ) : activeTab === "tts" ? (
          <TtsPanel settings={ttsSettings} onChange={onTtsSettingsChange} />
        ) : activeTab === "sync" ? (
          <SyncPanel
            settings={syncSettings}
            busy={syncBusy}
            status={syncStatus}
            onChange={onSyncSettingsChange}
            onPush={onSyncPush}
            onPull={onSyncPull}
          />
        ) : activeTab === "mcp" ? (
          <McpPanel servers={mcpServers} onChange={onMcpServersChange} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          {/* 左侧 provider 列表 */}
          <aside className="max-h-48 w-full shrink-0 overflow-y-auto border-b border-neutral-200 dark:border-neutral-800 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
            <ul>
              {providers.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => startEdit(p)}
                    className={`w-full text-left px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
                      editingId === p.id
                        ? "bg-neutral-100 dark:bg-neutral-800"
                        : ""
                    }`}
                  >
                    <div className="font-medium text-sm">{p.name || "(unnamed)"}</div>
                    <div className="text-xs text-neutral-500 truncate">{p.baseUrl}</div>
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={startNew}
              className="w-full px-4 py-3 text-sm text-left text-blue-600 dark:text-blue-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              + Add Provider
            </button>
          </aside>

          {/* 右侧表单 */}
          <section className="flex-1 overflow-y-auto p-4 sm:p-6">
            {!draft ? (
              <div className="text-neutral-500 text-sm">
                Select a provider on the left, or add a new one.
              </div>
            ) : (
              <div className="space-y-4 max-w-xl">
                <Field label="Name">
                  <input
                    className="input"
                    placeholder="e.g. OpenRouter"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </Field>

                <Field label="Kind">
                  <select
                    className="input"
                    value={draft.kind}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        kind: e.target.value as ProviderKind,
                      })
                    }
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="anthropic" disabled>
                      Anthropic (native, coming soon)
                    </option>
                  </select>
                </Field>

                <Field label="Base URL">
                  <input
                    className="input"
                    placeholder="https://openrouter.ai/api/v1"
                    value={draft.baseUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, baseUrl: e.target.value })
                    }
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    Should end with <code>/v1</code> (the endpoint will be{" "}
                    <code>&lt;base&gt;/chat/completions</code>).
                  </p>
                </Field>

                <Field label="API Key">
                  <input
                    className="input"
                    type="password"
                    placeholder="sk-..."
                    value={draft.apiKey}
                    onChange={(e) =>
                      setDraft({ ...draft, apiKey: e.target.value })
                    }
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    Stored in your browser only. Never leaves your device except
                    to call the provider you configure.
                  </p>
                </Field>

                <Field label="Models (one per line)">
                  <textarea
                    className="input font-mono text-sm"
                    rows={6}
                    placeholder={"anthropic/claude-opus-4-7\nanthropic/claude-opus-4-6"}
                    value={modelsText}
                    onChange={(e) => setModelsText(e.target.value)}
                  />
                </Field>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveDraft}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm"
                  >
                    Cancel
                  </button>
                  {providers.some((p) => p.id === draft.id) && (
                    <button
                      onClick={() => deleteProvider(draft.id)}
                      className="ml-auto px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
        )}
      </div>
    </div>
  );
}

function emptyMcpServer(): McpServerConfig {
  return {
    id: newMcpServerId(),
    name: "",
    url: "",
    bearerToken: "",
    enabled: true,
  };
}

function McpPanel({
  servers,
  onChange,
}: {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpServerConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);

  function startEdit(server: McpServerConfig) {
    setEditingId(server.id);
    setDraft({ ...server });
    setTestError(null);
    setTestResult(null);
  }

  function startNew() {
    const fresh = emptyMcpServer();
    setEditingId(fresh.id);
    setDraft(fresh);
    setTestError(null);
    setTestResult(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setTestError(null);
    setTestResult(null);
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.url.trim()) {
      alert("Name and URL are required");
      return;
    }

    const exists = servers.some((server) => server.id === draft.id);
    const next = exists
      ? servers.map((server) => (server.id === draft.id ? draft : server))
      : [...servers, draft];
    onChange(next);
    cancelEdit();
  }

  function deleteServer(id: string) {
    if (!confirm("Delete this MCP server?")) return;
    onChange(servers.filter((server) => server.id !== id));
    if (editingId === id) cancelEdit();
  }

  async function testDraft() {
    if (!draft) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testMcpServer(draft);
      setTestResult(result);
    } catch (error: unknown) {
      setTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
      <aside className="max-h-48 w-full shrink-0 overflow-y-auto border-b border-neutral-200 dark:border-neutral-800 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
        <ul>
          {servers.map((server) => (
            <li key={server.id}>
              <button
                onClick={() => startEdit(server)}
                className={`w-full text-left px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
                  editingId === server.id
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : ""
                }`}
              >
                <div className="font-medium text-sm">
                  {server.name || "(unnamed)"}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {server.url}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={startNew}
          className="w-full px-4 py-3 text-sm text-left text-blue-600 dark:text-blue-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          + Add MCP server
        </button>
      </aside>

      <section className="flex-1 overflow-y-auto p-4 sm:p-6">
        {!draft ? (
          <div className="text-neutral-500 text-sm">
            Select an MCP server on the left, or add a remote HTTP MCP server.
          </div>
        ) : (
          <div className="space-y-4 max-w-xl">
            <Field label="Name">
              <input
                className="input"
                placeholder="e.g. My MCP server"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>

            <Field label="Streamable HTTP URL">
              <input
                className="input"
                placeholder="https://example.com/mcp"
                value={draft.url}
                onChange={(event) =>
                  setDraft({ ...draft, url: event.target.value })
                }
              />
              <p className="text-xs text-neutral-500 mt-1">
                Browser access requires the MCP server to allow CORS.
              </p>
            </Field>

            <Field label="Bearer Token">
              <input
                className="input"
                type="password"
                placeholder="optional"
                value={draft.bearerToken}
                onChange={(event) =>
                  setDraft({ ...draft, bearerToken: event.target.value })
                }
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              Enabled
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={saveDraft}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Save
              </button>
              <button
                onClick={testDraft}
                disabled={testing || !draft.url.trim()}
                className="px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm disabled:opacity-50"
              >
                {testing ? "Testing..." : "Test"}
              </button>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm"
              >
                Cancel
              </button>
              {servers.some((server) => server.id === draft.id) && (
                <button
                  onClick={() => deleteServer(draft.id)}
                  className="ml-auto px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded text-sm"
                >
                  Delete
                </button>
              )}
            </div>

            {testError && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {testError}
              </div>
            )}

            {testResult && (
              <div className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="font-medium">Connected</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {testResult.serverInfo || "MCP server"}
                  {testResult.protocolVersion
                    ? ` · protocol ${testResult.protocolVersion}`
                    : ""}
                </div>
                <div className="mt-3 text-xs uppercase tracking-wide text-neutral-400">
                  Tools
                </div>
                {testResult.tools.length === 0 ? (
                  <div className="mt-1 text-neutral-500">No tools returned.</div>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {testResult.tools.map((tool) => (
                      <li key={tool.name}>
                        <div className="font-mono text-xs">{tool.name}</div>
                        {tool.description && (
                          <div className="text-xs text-neutral-500">
                            {tool.description}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function TtsPanel({
  settings,
  onChange,
}: {
  settings: TtsSettings;
  onChange: (settings: TtsSettings) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const activeProfile = getActiveTtsProfile(settings);

  function patchSettings(next: Partial<TtsSettings>) {
    onChange({ ...settings, ...next });
  }

  function updateProfile(patch: Partial<TtsProfile>) {
    if (!activeProfile) return;
    onChange({
      ...settings,
      profiles: settings.profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, ...patch } : profile,
      ),
    });
  }

  function addProfile() {
    const profile = createTtsProfile({
      name: `Voice ${settings.profiles.length + 1}`,
    });
    onChange({
      ...settings,
      profiles: [...settings.profiles, profile],
      activeProfileId: profile.id,
    });
    setTestError(null);
  }

  function deleteProfile(id: string) {
    if (!confirm("Delete this voice profile?")) return;
    const nextProfiles = settings.profiles.filter((profile) => profile.id !== id);
    onChange({
      ...settings,
      profiles: nextProfiles,
      activeProfileId:
        settings.activeProfileId === id
          ? (nextProfiles[0]?.id ?? null)
          : settings.activeProfileId,
    });
    setTestError(null);
  }

  async function testVoice() {
    if (!activeProfile) {
      setTestError("Add or select a voice profile first.");
      return;
    }
    setTesting(true);
    setTestError(null);
    try {
      await playTts(activeProfile, "Cedar Chat voice test.");
    } catch (error: unknown) {
      setTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  }

  const providerLabel =
    activeProfile?.provider === "elevenlabs"
      ? "ElevenLabs"
      : activeProfile?.provider === "minimax"
        ? "MiniMax"
        : activeProfile?.provider === "azure"
          ? "Azure Speech"
          : "Edge";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
      <aside className="max-h-52 w-full shrink-0 overflow-y-auto border-b border-neutral-200 dark:border-neutral-800 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
        <div className="space-y-3 border-b border-neutral-200 p-3 dark:border-neutral-800">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">Enable voice playback</span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                patchSettings({ enabled: event.target.checked })
              }
            />
          </label>
          <button
            onClick={addProfile}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + Add voice
          </button>
        </div>
        <nav className="max-h-full overflow-y-auto p-2">
          {settings.profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => patchSettings({ activeProfileId: profile.id })}
              className={`w-full rounded px-3 py-2 text-left text-sm ${
                activeProfile?.id === profile.id
                  ? "bg-neutral-100 dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <span className="block truncate font-medium">
                {profile.name || "Voice profile"}
              </span>
              <span className="block truncate text-xs text-neutral-500">
                {profile.provider}
                {profile.voice ? ` · ${profile.voice}` : ""}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex-1 overflow-y-auto p-4 sm:p-6">
        {!activeProfile ? (
          <div className="text-sm text-neutral-500">
            Add a voice profile to configure TTS.
          </div>
        ) : (
          <div className="max-w-xl space-y-5">
            <Field label="Name">
              <input
                className="input"
                placeholder="e.g. ElevenLabs Lily"
                value={activeProfile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
              />
            </Field>

            <Field label="Provider">
              <select
                className="select w-full"
                value={activeProfile.provider}
                onChange={(event) =>
                  updateProfile({
                    provider: event.target.value as TtsProviderKind,
                  })
                }
              >
                <option value="elevenlabs">ElevenLabs</option>
                <option value="minimax">MiniMax</option>
                <option value="azure">Azure Speech</option>
                <option value="edge">Edge / browser speech</option>
              </select>
            </Field>

            {activeProfile.provider !== "edge" && (
              <Field label="API Key">
                <input
                  className="input"
                  type="password"
                  placeholder={`${providerLabel} key`}
                  value={activeProfile.apiKey}
                  onChange={(event) =>
                    updateProfile({ apiKey: event.target.value })
                  }
                />
              </Field>
            )}

            {activeProfile.provider === "azure" && (
              <Field label="Azure Region">
                <input
                  className="input"
                  placeholder="eastus"
                  value={activeProfile.region}
                  onChange={(event) =>
                    updateProfile({ region: event.target.value })
                  }
                />
              </Field>
            )}

            <Field
              label={activeProfile.provider === "edge" ? "Proxy URL" : "Base URL"}
            >
              <input
                className="input"
                placeholder={
                  activeProfile.provider === "elevenlabs"
                    ? "https://api.elevenlabs.io/v1"
                    : activeProfile.provider === "minimax"
                      ? "https://api.minimax.io or https://api.minimaxi.com"
                      : activeProfile.provider === "azure"
                        ? "optional full Azure endpoint"
                        : "optional local edge-tts HTTP endpoint"
                }
                value={activeProfile.baseUrl}
                onChange={(event) =>
                  updateProfile({ baseUrl: event.target.value })
                }
              />
              {activeProfile.provider === "edge" && (
                <p className="mt-1 text-xs text-neutral-500">
                  Leave empty to use the browser speech engine.
                </p>
              )}
              {activeProfile.provider === "minimax" && (
                <p className="mt-1 text-xs text-neutral-500">
                  Global keys use https://api.minimax.io. Mainland keys use
                  https://api.minimaxi.com. You can enter the host or the full
                  /v1/t2a_v2 endpoint.
                </p>
              )}
            </Field>

            {activeProfile.provider === "minimax" && (
              <Field label="Group ID">
                <input
                  className="input"
                  placeholder="optional"
                  value={activeProfile.groupId}
                  onChange={(event) =>
                    updateProfile({ groupId: event.target.value })
                  }
                />
              </Field>
            )}

            <Field label="Voice">
              <input
                className="input"
                placeholder={
                  activeProfile.provider === "azure"
                    ? "en-US-JennyNeural"
                    : activeProfile.provider === "edge"
                      ? "browser voice name or edge-tts voice"
                      : "voice ID"
                }
                value={activeProfile.voice}
                onChange={(event) => updateProfile({ voice: event.target.value })}
              />
            </Field>

            <Field label="Model">
              <input
                className="input"
                placeholder={
                  activeProfile.provider === "elevenlabs"
                    ? "eleven_multilingual_v2"
                    : activeProfile.provider === "minimax"
                      ? "speech-2.8-hd"
                      : "optional"
                }
                value={activeProfile.model}
                onChange={(event) => updateProfile({ model: event.target.value })}
              />
            </Field>

            {activeProfile.provider === "azure" && (
              <Field label="Output format">
                <input
                  className="input"
                  placeholder="audio-24khz-48kbitrate-mono-mp3"
                  value={activeProfile.outputFormat}
                  onChange={(event) =>
                    updateProfile({ outputFormat: event.target.value })
                  }
                />
              </Field>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={testVoice}
                disabled={testing}
                className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {testing ? "Testing..." : "Test voice"}
              </button>
              <button
                onClick={() => deleteProfile(activeProfile.id)}
                className="ml-auto rounded px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                Delete
              </button>
            </div>

            {testError && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {testError}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SyncPanel({
  settings,
  busy,
  status,
  onChange,
  onPush,
  onPull,
}: {
  settings: SyncSettings;
  busy: boolean;
  status: string | null;
  onChange: (settings: SyncSettings) => void;
  onPush: () => void;
  onPull: () => void;
}) {
  const canSync = settings.endpoint.trim() && settings.syncCode.trim().length >= 8;
  const intervalSeconds = Math.round(settings.autoSyncIntervalMs / 1000);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-xl space-y-5">
        <Field label="Sync URL">
          <input
            className="input"
            placeholder="https://mcp-gateway.yixinliu1024.workers.dev"
            value={settings.endpoint}
            onChange={(event) =>
              onChange({ ...settings, endpoint: event.target.value })
            }
          />
        </Field>

        <Field label="Sync Code">
          <input
            className="input"
            type="password"
            placeholder="at least 8 characters"
            value={settings.syncCode}
            onChange={(event) =>
              onChange({ ...settings, syncCode: event.target.value })
            }
          />
        </Field>

        <Field label="Device Name">
          <input
            className="input"
            placeholder="MacBook, iPhone..."
            value={settings.deviceName}
            onChange={(event) =>
              onChange({ ...settings, deviceName: event.target.value })
            }
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onPull}
            disabled={busy || !canSync}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Sync
          </button>
          <button
            onClick={onPush}
            disabled={busy || !canSync}
            className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Upload only
          </button>
        </div>

        {/* Auto Sync Settings */}
        <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoSyncEnabled}
                disabled={!canSync}
                onChange={(event) =>
                  onChange({ ...settings, autoSyncEnabled: event.target.checked })
                }
                className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
              />
              Auto Sync
            </label>
          </div>
          {settings.autoSyncEnabled && (
            <Field label="Sync Interval (seconds)">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={600}
                  step={10}
                  value={intervalSeconds}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      autoSyncIntervalMs: parseInt(event.target.value) * 1000,
                    })
                  }
                  className="flex-1"
                  aria-label="Auto sync interval"
                />
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={intervalSeconds}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      autoSyncIntervalMs:
                        Math.max(10, Math.min(600, parseInt(event.target.value) || 30)) *
                        1000,
                    })
                  }
                  className="input w-20"
                  aria-label="Auto sync interval in seconds"
                />
                <span className="text-xs text-neutral-500">sec</span>
              </div>
            </Field>
          )}
          {settings.autoSyncEnabled && (
            <p className="text-xs text-neutral-500 mt-2">
              Automatically syncs when the tab is visible. Also syncs on tab
              focus and network reconnect.
            </p>
          )}
        </div>

        <div className="space-y-1 text-xs text-neutral-500">
          <div>Last upload: {formatSyncTime(settings.lastPushedAt)}</div>
          <div>Last download: {formatSyncTime(settings.lastPulledAt)}</div>
        </div>

        {status && (
          <div className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSyncTime(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function PreferencesPanel({
  preferences,
  userStyle,
  onChange,
  onUserStyleChange,
}: {
  preferences: Preferences;
  userStyle: string;
  onChange: (p: Preferences) => void;
  onUserStyleChange: (style: string) => void;
}) {
  const depth = preferences.historyDepth;
  const isUnlimited = depth === "all";
  const numericDepth = typeof depth === "number" ? depth : 20;
  const chatFontSize = preferences.chatFontSize;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-xl space-y-6">
        <section>
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            Chat text size
          </h3>
          <p className="text-xs text-neutral-500 mb-3">
            Adjust the reading size for message text and the composer.
          </p>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min={14}
              max={24}
              step={1}
              value={chatFontSize}
              onChange={(e) =>
                onChange({
                  ...preferences,
                  chatFontSize: parseInt(e.target.value),
                })
              }
              className="flex-1"
              aria-label="Chat text size"
            />
            <input
              type="number"
              min={14}
              max={24}
              value={chatFontSize}
              onChange={(e) =>
                onChange({
                  ...preferences,
                  chatFontSize: Math.max(
                    14,
                    Math.min(24, parseInt(e.target.value) || 18),
                  ),
                })
              }
              className="input w-20"
              aria-label="Chat text size in pixels"
            />
            <span className="text-sm text-neutral-500">px</span>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            Conversation history
          </h3>
          <p className="text-xs text-neutral-500 mb-3">
            How many past messages to include when sending a new message. Fewer
            messages = cheaper requests + faster responses, but the model has
            less memory of earlier turns.
          </p>

          <label className="flex items-center gap-2 text-sm mb-3">
            <input
              type="checkbox"
              checked={isUnlimited}
              onChange={(e) =>
                onChange({
                  ...preferences,
                  historyDepth: e.target.checked ? "all" : numericDepth,
                })
              }
            />
            Unlimited (send all history)
          </label>

          {!isUnlimited && (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={300}
                step={1}
                value={numericDepth}
                onChange={(e) =>
                  onChange({
                    ...preferences,
                    historyDepth: parseInt(e.target.value),
                  })
                }
                className="flex-1"
              />
              <input
                type="number"
                min={0}
                max={300}
                value={numericDepth}
                onChange={(e) =>
                  onChange({
                    ...preferences,
                    historyDepth: Math.max(
                      0,
                      Math.min(300, parseInt(e.target.value) || 0),
                    ),
                  })
                }
                className="input w-20"
              />
              <span className="text-sm text-neutral-500">messages</span>
            </div>
          )}

          <p className="mt-2 text-xs text-neutral-400">
            <strong>0</strong> = one-shot (no history).{" "}
            <strong>20</strong> ≈ last 10 user/assistant pairs.
          </p>
        </section>
        <section>
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            User Style
          </h3>
          <p className="text-xs text-neutral-500 mb-3">
            Custom style instructions appended to the system prompt for every
            message, regardless of which Agent is active.
          </p>
          <textarea
            className="input w-full font-mono text-sm"
            rows={5}
            placeholder="e.g. Reply in concise Chinese. Use TypeScript for code examples. Avoid emoji."
            value={userStyle}
            onChange={(e) => onUserStyleChange(e.target.value)}
          />
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
