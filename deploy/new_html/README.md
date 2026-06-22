# MECHA Frontend

This directory contains the Vite/React frontend for MECHA. It is served by the
FastAPI backend after `npm run build` writes assets to `deploy/dist`.

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the backend from `deploy/` so API routes and auth cookies are available.

3. Start the frontend dev server:

   ```bash
   npm run dev
   ```

## API Keys

Do not put DeepSeek, Gemini, GPT Image, MiniMax, Seedance, DashScope, or other
provider keys in frontend `.env` files. Browser-facing `VITE_*` variables are
public after bundling.

Configure provider keys and endpoints in the backend admin page:

```text
/admin/settings?item=apiconfig
```

The frontend calls backend routes such as `/api/gemini/text`,
`/api/gemini/image`, `/api/gpt-image/generate`, and `/api/video/*`; the backend
resolves the active provider key, endpoint, model, proxy mode, and health status.
