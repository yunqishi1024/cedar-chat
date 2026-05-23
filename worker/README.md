# Cedar Chat Worker

Copy `worker/index.js` into the Cloudflare Worker online editor when you want
the R2 sync endpoint to support incremental sync.

The Worker keeps the old endpoints:

- `/sync/snapshot`
- `/sync/health`
- `/sync/blob/<id>`
- `/mcp/<target-name>`

It also adds the incremental endpoints used by the app:

- `/sync/v2/health`
- `/sync/v2/manifest`
- `/sync/v2/object?key=...`
- `/sync/v2/list?prefix=...`

Keep the existing Cloudflare bindings and variables, especially:

- `CEDAR_SYNC_BUCKET`
- `ALLOWED_ORIGINS`
- `MCP_TARGETS`
- `GATEWAY_BEARER_TOKEN` if you use one
