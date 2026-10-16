# AetherCAD

**Parametric CAD in the browser. Built on Cloudflare Workers, with GitHub Actions and no mandatory paid services.**

AetherCAD is a lightweight 3D workbench for quickly sketching dimensioned solids, editing features, and exporting printable STL files. Its editor works in the browser; natural-language planning uses Cloudflare Workers AI when available, and a deterministic local CAD parser otherwise.

## Capabilities

- **3D modeling** — boxes and plates, cylinders, spheres, corner fillets/chamfers, cylindrical cutouts, countersinks, and up to 12 editable holes.
- **Live inspector** — edit real dimensions in **millimeters**, including X/Y/Z positions of holes.
- **Professional viewport** — orbit, pan, zoom, isometric/top/front/right views, grid, shading, and wireframe.
- **Export** — binary STL in actual millimeter dimensions, editable project JSON, and JSON import.
- **Undo/redo** — 30-operation history; session persistence through browser localStorage.
- **Prompt-to-CAD** — server-side inference using a Workers AI binding; falls back to local parsing on quota exhaustion or when offline.
- **Responsive interface** — dark CAD-focused desktop and mobile layouts.

![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020)
![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF)
![Cost](https://img.shields.io/badge/required%20paid%20services-none-15A982)

## Tech stack

| Layer | Technology |
|---|---|
| UI | Vanilla JavaScript + CSS, Vite |
| 3D | Three.js, OrbitControls, three-csg-ts |
| CAD exports | Three.js STLExporter, JSON |
| API | Cloudflare Worker (same-origin) |
| AI | Cloudflare Workers AI, `@cf/meta/llama-3.1-8b-instruct` |
| Hosting | Cloudflare Workers Static Assets (`workers.dev`) |
| CI/CD | GitHub Actions |
| Project storage | localStorage + user-managed JSON files |

No Google Gemini key, paid database, third-party backend, or client-visible API token.

## Run locally

Requires Node.js 22 or higher.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. This mode provides the fully functional CAD editor and local natural-language rule engine without any credentials. Note: AI requests to `/api/generate` return to local mode until the Worker is running.

Run automated checks:

```bash
npm run check
```

## Run the Cloudflare Worker locally

```bash
npm run build
npm run preview
```

Wrangler serves the Vite build and Worker API. Workers AI binding behavior locally depends on the Wrangler/Cloudflare environment; when AI cannot run, the endpoint returns a rule-based CAD result.

## Deploy to Cloudflare for free

1. Create a **Cloudflare Free** account. No purchased domain is required.
2. In GitHub repository **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN`: a scoped Cloudflare API token permitted to edit Workers scripts in your account.
   - `CLOUDFLARE_ACCOUNT_ID`: the account ID shown in Cloudflare's dashboard.
3. Push to `main` or run the **AetherCAD CI & Cloudflare Deploy** workflow manually. The workflow validates tests and the build before invoking `cloudflare/wrangler-action@v3`.
4. The app will be available at the assigned `https://aethercad.<your-workers-subdomain>.workers.dev` hostname after the first successful deployment. The actual URL is shown in the GitHub Actions deployment log.

If the secrets are absent, CI still runs and the deploy job prints a warning instead of falsely claiming the site is live.

To deploy directly from your authenticated local machine:

```bash
npx wrangler login
npm run build
npm run deploy
```

Cloudflare **Workers AI Free** includes a daily inference quota, but requests above that quota are not free/unlimited. AetherCAD catches AI failures and falls back to local modeling. The app does not require purchasing a Workers Paid plan. See [Cloudflare AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Workers static assets](https://developers.cloudflare.com/workers/static-assets/).

## Example commands

```text
Create a 120x80x10 mounting plate with 4 holes
Make width 180
Add a 5mm fillet
Remove holes
Make a sphere radius 32
Create a cylinder height 100 radius 25
```

For reliable, precise output, numeric dimension fields in the inspector are the source of truth. Natural-language CAD is limited to the implemented shape/feature schema; this is not a full sketch-based mechanical CAD system with STEP or assembly support.

## API

- `GET /api/health` — `{ok, service, cloudflare, ai}`.
- `POST /api/generate` — `{"prompt":"...","model":{...}|null}`, response `{"model":{...},"mode":"ai"|"local"}`.
- Same-origin POST only. 600-character prompt limit. Normalized model dimensions are bounded to 0.2–2000 mm.

## Keyboard shortcuts

`Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo, `Ctrl/Cmd+S` download JSON, `Ctrl/Cmd+Enter` run prompt.

## Free tier considerations

Cloudflare's Free plan has request and AI inference limits. A large public audience can exhaust the free allocation, so the AI assistant is best-effort while manual CAD and local prompt parsing remain available. JSON files are private to the user's browser unless explicitly downloaded/shared. No accounts or cross-device sync are claimed.

## License

No license has been added by this restoration; copyright remains with the repository owner.
