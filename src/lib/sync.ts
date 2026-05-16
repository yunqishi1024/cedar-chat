import type { ProviderConfig } from "../providers";
import type {
  Agent,
  Conversation,
  CurrentSelection,
  McpServerConfig,
  Preferences,
  SyncSettings,
  TtsSettings,
} from "./storage";

export interface CedarSyncSnapshot {
  app: "cedar-chat";
  version: 1;
  exportedAt: string;
  deviceName?: string;
  current: CurrentSelection;
  preferences: Preferences;
  providers: ProviderConfig[];
  mcpServers: McpServerConfig[];
  ttsSettings: TtsSettings;
  agents: Agent[];
  activeAgentId: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
}

export interface PushSyncResult {
  updatedAt?: string;
  bytes?: number;
}

interface EncryptedSyncEnvelope {
  app: "cedar-chat-sync";
  version: 1;
  encrypted: true;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  exportedAt: string;
  deviceName?: string;
}

const SYNC_KDF_ITERATIONS = 120_000;

function snapshotUrl(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) throw new Error("Sync URL is required.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Sync URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:" && !url.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
    throw new Error("Sync URL must use HTTPS.");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/sync/snapshot")) {
    url.pathname = path;
  } else if (path.endsWith("/sync")) {
    url.pathname = `${path}/snapshot`;
  } else {
    url.pathname = `${path}/sync/snapshot`;
  }
  return url.toString();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function deriveSyncKey(
  syncCode: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(syncCode),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bytesToArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptSnapshot(
  snapshot: CedarSyncSnapshot,
  syncCode: string,
): Promise<EncryptedSyncEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSyncKey(syncCode, salt, SYNC_KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
    key,
    plaintext,
  );

  return {
    app: "cedar-chat-sync",
    version: 1,
    encrypted: true,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: SYNC_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
    exportedAt: snapshot.exportedAt,
    ...(snapshot.deviceName ? { deviceName: snapshot.deviceName } : {}),
  };
}

function isEncryptedEnvelope(value: unknown): value is EncryptedSyncEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.app === "cedar-chat-sync" &&
    record.version === 1 &&
    record.encrypted === true &&
    record.algorithm === "AES-GCM" &&
    record.kdf === "PBKDF2-SHA256" &&
    typeof record.iterations === "number" &&
    typeof record.salt === "string" &&
    typeof record.iv === "string" &&
    typeof record.data === "string"
  );
}

async function decryptSnapshot(
  envelope: EncryptedSyncEnvelope,
  syncCode: string,
): Promise<CedarSyncSnapshot> {
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const data = base64ToBytes(envelope.data);
    const key = await deriveSyncKey(syncCode, salt, envelope.iterations);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
      key,
      bytesToArrayBuffer(data),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as CedarSyncSnapshot;
  } catch {
    throw new Error("Could not decrypt cloud copy. Check the sync code.");
  }
}

function authHeaders(settings: SyncSettings): Record<string, string> {
  const syncCode = settings.syncCode.trim();
  if (syncCode.length < 8) {
    throw new Error("Sync code needs at least 8 characters.");
  }

  return {
    Authorization: `Bearer ${syncCode}`,
  };
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return new Error(parsed.message || parsed.error || `HTTP ${response.status}`);
  } catch {
    return new Error(text || `HTTP ${response.status}`);
  }
}

export async function pushSyncSnapshot(
  settings: SyncSettings,
  snapshot: CedarSyncSnapshot,
): Promise<PushSyncResult> {
  const syncCode = settings.syncCode.trim();
  const envelope = await encryptSnapshot(snapshot, syncCode);
  const body = JSON.stringify(envelope);
  let response: Response;

  try {
    response = await fetch(snapshotUrl(settings.endpoint), {
      method: "POST",
      headers: {
        ...authHeaders(settings),
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sync upload failed: ${message}`);
  }

  if (!response.ok) throw await responseError(response);

  const parsed = (await response.json().catch(() => ({}))) as PushSyncResult;
  return {
    updatedAt:
      parsed.updatedAt ??
      response.headers.get("X-Cedar-Sync-Updated-At") ??
      undefined,
    bytes: parsed.bytes,
  };
}

export async function pullSyncSnapshot(
  settings: SyncSettings,
): Promise<CedarSyncSnapshot | null> {
  let response: Response;

  try {
    response = await fetch(snapshotUrl(settings.endpoint), {
      method: "GET",
      headers: {
        ...authHeaders(settings),
        Accept: "application/json",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sync download failed: ${message}`);
  }

  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as unknown;
  if (isEncryptedEnvelope(payload)) {
    return decryptSnapshot(payload, settings.syncCode.trim());
  }
  return payload as CedarSyncSnapshot;
}
