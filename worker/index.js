const CORS_METHODS = "GET, POST, PUT, DELETE, HEAD, OPTIONS";
const CORS_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "Last-Event-ID",
  "MCP-Method",
  "MCP-Name",
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
].join(", ");
const EXPOSED_HEADERS = [
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
  "mcp-session-id",
  "X-Cedar-Sync-Updated-At",
  "X-Cedar-Sync-Version",
].join(", ");

const ROUTE_PATTERN = /^\/mcp\/([A-Za-z0-9_.-]+)\/?$/;
const SYNC_PREFIX = "/sync";
const SYNC_SNAPSHOT_PATH = "/sync/snapshot";
const SYNC_HEALTH_PATH = "/sync/health";
const SYNC_BLOB_PATTERN = /^\/sync\/blob\/([A-Za-z0-9_-]{6,160})$/;
const SYNC_V2_OBJECT_KEY_PATTERN = /^[A-Za-z0-9_.\/=-]{1,512}$/;

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, { fetcher: fetch, ctx });
  },
};

export async function handleRequest(request, env = {}, options = {}) {
  const requestUrl = new URL(request.url);
  const cors = getCorsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: cors.allowed ? 204 : 403,
      headers: cors.headers,
    });
  }
  if (requestUrl.pathname === "/" || requestUrl.pathname === "/health") {
    return jsonResponse(
      { ok: true, service: "mcp-gateway" },
      { status: 200, cors },
    );
  }
  if (!cors.allowed) {
    return jsonResponse(
      { error: "origin_not_allowed" },
      { status: 403, cors },
    );
  }
  if (requestUrl.pathname.startsWith(SYNC_PREFIX)) {
    return handleSyncRequest(request, env, cors);
  }

  const routeMatch = requestUrl.pathname.match(ROUTE_PATTERN);
  if (!routeMatch) {
    return jsonResponse(
      { error: "not_found", hint: "Use /mcp/<target-name>." },
      { status: 404, cors },
    );
  }
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, cors, extraHeaders: { Allow: CORS_METHODS } },
    );
  }

  const gatewayAuth = authorizeGateway(request, env);
  if (!gatewayAuth.ok) {
    return jsonResponse(
      { error: "unauthorized" },
      {
        status: 401,
        cors,
        extraHeaders: { "WWW-Authenticate": 'Bearer realm="mcp-gateway"' },
      },
    );
  }

  let target;
  try {
    target = await resolveTarget(routeMatch[1], env);
  } catch (error) {
    return jsonResponse(
      { error: "bad_gateway_config", message: error.message },
      { status: 500, cors },
    );
  }
  if (!target) {
    return jsonResponse({ error: "unknown_target" }, { status: 404, cors });
  }
  if (!isManagedSecretTargetProtected(target, env)) {
    return jsonResponse(
      {
        error: "gateway_auth_required",
        message:
          "Targets with gateway-managed upstream tokens require GATEWAY_BEARER_TOKEN.",
      },
      { status: 500, cors },
    );
  }
  if (await shouldSwallowInitializedNotification(request, target)) {
    return new Response(null, {
      status: 202,
      headers: cors.headers,
    });
  }

  const upstreamUrl = buildUpstreamUrl(target, requestUrl, env);
  if (!upstreamUrl) {
    return jsonResponse({ error: "bad_target_url" }, { status: 500, cors });
  }
  if (
    upstreamUrl.protocol !== "https:" &&
    String(env.ALLOW_HTTP_TARGETS ?? "").toLowerCase() !== "true"
  ) {
    return jsonResponse(
      { error: "insecure_target", message: "Target URLs must use HTTPS." },
      { status: 500, cors },
    );
  }

  const upstreamHeaders = buildUpstreamHeaders(request, target, env);
  const fetcher = options.fetcher ?? fetch;
  try {
    const upstreamResponse = await fetcher(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === "GET" ? undefined : request.body,
      redirect: "follow",
    });
    return addCorsToResponse(upstreamResponse, cors);
  } catch (error) {
    return jsonResponse(
      {
        error: "upstream_fetch_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502, cors },
    );
  }
}

async function handleSyncRequest(request, env, cors) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === SYNC_HEALTH_PATH) {
    return jsonResponse(
      {
        ok: true,
        service: "cedar-chat-sync",
        bucketBound: Boolean(env.CEDAR_SYNC_BUCKET),
        version: 2,
      },
      { status: 200, cors, extraHeaders: { "X-Cedar-Sync-Version": "2" } },
    );
  }
  if (!env.CEDAR_SYNC_BUCKET) {
    return jsonResponse(
      {
        error: "sync_bucket_not_configured",
        message: "Bind an R2 bucket as CEDAR_SYNC_BUCKET.",
      },
      { status: 500, cors },
    );
  }
  const auth = await authorizeSyncRequest(request);
  if (!auth.ok) {
    return jsonResponse(
      { error: auth.error },
      {
        status: 401,
        cors,
        extraHeaders: { "WWW-Authenticate": 'Bearer realm="cedar-chat-sync"' },
      },
    );
  }

  if (requestUrl.pathname.startsWith("/sync/v2")) {
    return handleSyncV2Request(request, env, cors, auth.namespace);
  }
  const blobMatch = requestUrl.pathname.match(SYNC_BLOB_PATTERN);
  if (blobMatch) {
    return handleSyncBlobRequest(request, env, cors, auth.namespace, blobMatch[1]);
  }
  if (requestUrl.pathname === SYNC_SNAPSHOT_PATH) {
    return handleSyncSnapshotRequest(request, env, cors, auth.objectKey);
  }
  return jsonResponse({ error: "not_found" }, { status: 404, cors });
}

async function handleSyncSnapshotRequest(request, env, cors, objectKey) {
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, cors, extraHeaders: { Allow: CORS_METHODS } },
    );
  }
  if (request.method === "GET") {
    const object = await env.CEDAR_SYNC_BUCKET.get(objectKey);
    if (!object) {
      return jsonResponse({ error: "not_found" }, { status: 404, cors });
    }
    const headers = new Headers(cors.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    const updatedAt = object.customMetadata?.updatedAt;
    if (updatedAt) headers.set("X-Cedar-Sync-Updated-At", updatedAt);
    return new Response(object.body, { status: 200, headers });
  }
  if (request.method === "DELETE") {
    await env.CEDAR_SYNC_BUCKET.delete(objectKey);
    return jsonResponse({ ok: true }, { status: 200, cors });
  }
  return putJsonObject(request, env, cors, objectKey, {
    emptyError: "empty_snapshot",
    tooLargeError: "snapshot_too_large",
    validateJson: true,
  });
}

async function handleSyncBlobRequest(request, env, cors, namespace, id) {
  const objectKey = `${namespace}/blob/${id}.json`;
  if (!["GET", "PUT", "POST", "DELETE", "HEAD"].includes(request.method)) {
    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, cors, extraHeaders: { Allow: CORS_METHODS } },
    );
  }
  return handleObjectStorageRequest(request, env, cors, objectKey);
}

async function handleSyncV2Request(request, env, cors, namespace) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/sync/v2/health") {
    return jsonResponse(
      { ok: true, service: "cedar-chat-sync", version: 2 },
      { status: 200, cors, extraHeaders: { "X-Cedar-Sync-Version": "2" } },
    );
  }
  if (requestUrl.pathname === "/sync/v2/manifest") {
    return handleObjectStorageRequest(
      request,
      env,
      cors,
      `${namespace}/v2/manifest.json`,
    );
  }
  if (requestUrl.pathname === "/sync/v2/object") {
    const key = requestUrl.searchParams.get("key") ?? "";
    if (!SYNC_V2_OBJECT_KEY_PATTERN.test(key) || key.includes("..")) {
      return jsonResponse({ error: "invalid_object_key" }, { status: 400, cors });
    }
    return handleObjectStorageRequest(
      request,
      env,
      cors,
      `${namespace}/v2/objects/${key}`,
    );
  }
  if (requestUrl.pathname === "/sync/v2/list") {
    if (request.method !== "GET") {
      return jsonResponse(
        { error: "method_not_allowed" },
        { status: 405, cors, extraHeaders: { Allow: CORS_METHODS } },
      );
    }
    const prefix = requestUrl.searchParams.get("prefix") ?? "";
    if (prefix && (!SYNC_V2_OBJECT_KEY_PATTERN.test(prefix) || prefix.includes(".."))) {
      return jsonResponse({ error: "invalid_prefix" }, { status: 400, cors });
    }
    const listed = await env.CEDAR_SYNC_BUCKET.list({
      prefix: `${namespace}/v2/objects/${prefix}`,
    });
    return jsonResponse(
      {
        ok: true,
        objects: listed.objects.map((object) => ({
          key: object.key.slice(`${namespace}/v2/objects/`.length),
          size: object.size,
          uploaded: object.uploaded,
          etag: object.etag,
          customMetadata: object.customMetadata,
        })),
      },
      { status: 200, cors },
    );
  }
  return jsonResponse({ error: "not_found" }, { status: 404, cors });
}

async function handleObjectStorageRequest(request, env, cors, objectKey) {
  if (!["GET", "PUT", "POST", "DELETE", "HEAD"].includes(request.method)) {
    return jsonResponse(
      { error: "method_not_allowed" },
      { status: 405, cors, extraHeaders: { Allow: CORS_METHODS } },
    );
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const object = await env.CEDAR_SYNC_BUCKET.get(objectKey);
    if (!object) {
      return request.method === "HEAD"
        ? new Response(null, { status: 404, headers: cors.headers })
        : jsonResponse({ error: "not_found" }, { status: 404, cors });
    }
    const headers = new Headers(cors.headers);
    headers.set(
      "Content-Type",
      object.httpMetadata?.contentType ?? "application/json; charset=utf-8",
    );
    const updatedAt = object.customMetadata?.updatedAt;
    if (updatedAt) headers.set("X-Cedar-Sync-Updated-At", updatedAt);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }
  if (request.method === "DELETE") {
    await env.CEDAR_SYNC_BUCKET.delete(objectKey);
    return jsonResponse({ ok: true }, { status: 200, cors });
  }
  return putJsonObject(request, env, cors, objectKey, {
    emptyError: "empty_object",
    tooLargeError: "object_too_large",
    validateJson: true,
  });
}

async function putJsonObject(request, env, cors, objectKey, options) {
  const body = await request.text();
  const bytes = new TextEncoder().encode(body).byteLength;
  const maxBytes = Number.parseInt(env.MAX_SYNC_BYTES ?? "52428800", 10);
  if (!body.trim()) {
    return jsonResponse({ error: options.emptyError }, { status: 400, cors });
  }
  if (bytes > maxBytes) {
    return jsonResponse(
      {
        error: options.tooLargeError,
        message: `Object is ${bytes} bytes; max is ${maxBytes} bytes.`,
      },
      { status: 413, cors },
    );
  }
  if (options.validateJson) {
    try {
      JSON.parse(body);
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400, cors });
    }
  }

  const updatedAt = new Date().toISOString();
  await env.CEDAR_SYNC_BUCKET.put(objectKey, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      updatedAt,
      bytes: String(bytes),
    },
  });
  return jsonResponse(
    { ok: true, updatedAt, bytes },
    {
      status: 200,
      cors,
      extraHeaders: { "X-Cedar-Sync-Updated-At": updatedAt },
    },
  );
}

async function authorizeSyncRequest(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!token) return { ok: false, error: "sync_token_required" };
  if (token.length < 8) return { ok: false, error: "sync_token_too_short" };
  const tokenHash = await sha256Hex(token);
  const namespace = `sync/${tokenHash}`;
  return {
    ok: true,
    namespace,
    objectKey: `${namespace}/snapshot.json`,
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseTargets(rawTargets) {
  if (!rawTargets || !rawTargets.trim()) return {};
  const parsed = JSON.parse(rawTargets);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP_TARGETS must be a JSON object.");
  }
  const targets = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error(`Invalid target name: ${name}`);
    }
    if (typeof value === "string") {
      targets[name] = { url: value };
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid config for target: ${name}`);
    }
    targets[name] = {
      url: value.url,
      bearerEnv: value.bearerEnv,
      bearerToken: value.bearerToken,
      forwardClientAuthorization: value.forwardClientAuthorization === true,
      headers: normalizeStaticHeaders(value.headers),
      query: normalizeStaticQuery(value.query),
      queryEnv: normalizeStaticQuery(value.queryEnv),
      swallowInitializedNotification:
        value.swallowInitializedNotification === true,
    };
  }
  return targets;
}

async function resolveTarget(name, env) {
  const targets = parseTargets(env.MCP_TARGETS ?? "");
  if (targets[name]) return targets[name];
  if (env.MCP_TARGETS_KV && typeof env.MCP_TARGETS_KV.get === "function") {
    const raw = await env.MCP_TARGETS_KV.get(name);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value === "string") return { url: value };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid KV config for target: ${name}`);
    }
    return {
      url: value.url,
      bearerEnv: value.bearerEnv,
      bearerToken: value.bearerToken,
      forwardClientAuthorization: value.forwardClientAuthorization === true,
      headers: normalizeStaticHeaders(value.headers),
      query: normalizeStaticQuery(value.query),
      queryEnv: normalizeStaticQuery(value.queryEnv),
      swallowInitializedNotification:
        value.swallowInitializedNotification === true,
    };
  }
  return null;
}

function normalizeStaticHeaders(headers) {
  if (!headers) return {};
  if (typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("headers must be an object.");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error(`Header ${key} must be a string.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeStaticQuery(query) {
  if (!query) return {};
  if (typeof query !== "object" || Array.isArray(query)) {
    throw new Error("query and queryEnv must be objects.");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== "string") {
      throw new Error(`Query value ${key} must be a string.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function buildUpstreamUrl(target, requestUrl, env) {
  try {
    const upstreamUrl = new URL(target.url);
    for (const [key, value] of Object.entries(target.query ?? {})) {
      upstreamUrl.searchParams.set(key, value);
    }
    for (const [key, envName] of Object.entries(target.queryEnv ?? {})) {
      const value = String(env[envName] ?? "");
      if (value) upstreamUrl.searchParams.set(key, value);
    }
    for (const [key, value] of requestUrl.searchParams) {
      upstreamUrl.searchParams.append(key, value);
    }
    return upstreamUrl;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(request, target, env) {
  const headers = new Headers();
  const copiedHeaders = [
    "accept",
    "content-type",
    "last-event-id",
    "mcp-protocol-version",
    "mcp-session-id",
  ];
  for (const headerName of copiedHeaders) {
    const value = request.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }
  for (const [key, value] of Object.entries(target.headers ?? {})) {
    headers.set(key, value);
  }
  const bearerToken = resolveTargetBearerToken(target, env);
  const clientAuthorization = request.headers.get("authorization");
  if (bearerToken) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  } else if (target.forwardClientAuthorization && clientAuthorization) {
    headers.set("authorization", clientAuthorization);
  }
  return headers;
}

async function shouldSwallowInitializedNotification(request, target) {
  if (!target.swallowInitializedNotification) return false;
  if (request.method !== "POST") return false;
  try {
    const payload = await request.clone().json();
    return payload?.method === "notifications/initialized";
  } catch {
    return false;
  }
}

function resolveTargetBearerToken(target, env) {
  if (target.bearerEnv) return env[target.bearerEnv] || "";
  return target.bearerToken || "";
}

function isManagedSecretTargetProtected(target, env) {
  const targetHasGatewayManagedSecret = Boolean(
    target.bearerEnv ||
      target.bearerToken ||
      Object.keys(target.queryEnv ?? {}).length > 0,
  );
  if (!targetHasGatewayManagedSecret) return true;
  if (String(env.GATEWAY_BEARER_TOKEN ?? "").trim()) return true;
  return String(env.ALLOW_PUBLIC_SECRET_TARGETS ?? "").toLowerCase() === "true";
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? "");
  const allowAll = allowedOrigins.has("*");
  const originAllowed = !origin || allowAll || allowedOrigins.has(origin);
  const headers = new Headers({
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
  if (origin && originAllowed) {
    headers.set("Access-Control-Allow-Origin", allowAll ? "*" : origin);
  }
  return {
    allowed: originAllowed,
    headers,
  };
}

function parseAllowedOrigins(rawOrigins) {
  return new Set(
    rawOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function authorizeGateway(request, env) {
  const expectedToken = String(env.GATEWAY_BEARER_TOKEN ?? "").trim();
  if (!expectedToken) return { ok: true };
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  return { ok: safeEqual(token, expectedToken) };
}

function safeEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < actual.length; index += 1) {
    result |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
}

function addCorsToResponse(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of cors.headers) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(body, options = {}) {
  const headers = new Headers(options.extraHeaders ?? {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (options.cors) {
    for (const [key, value] of options.cors.headers) {
      headers.set(key, value);
    }
  }
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  });
}
