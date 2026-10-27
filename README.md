<p align="center"><img src="frontend/public/logo-192.png" width="96" alt="DepJenga logo" /></p>

<h1 align="center">DepJenga</h1>

**Your dependency tree is a Jenga tower.** Paste a GitHub repo and DepJenga stacks every package as a
physics block. Blocks **glow by real CVE severity** and get **thinner when their maintainers are a bus factor
away from vanishing**. Then pull blocks, set off a package's blast radius, or shake the table, and watch what falls.

Built for Hacktoberfest. React + TypeScript + Three.js / React Three Fiber + Rapier physics, with a Java Spring Boot
analysis engine on top of OSV.dev, the GitHub Advisory Database, deps.dev, OpenSSF Scorecard and the npm registry.

---

## Quick start

Prerequisites: **Java 21+**, **Maven 3.9+**, **Node 20+**.

```bash
# 1. backend (port 8080)
cd backend
mvn spring-boot:run
```

```bash
# 2. frontend (port 5173, proxies /api to 8080)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and paste a repo, e.g. `expressjs/express`. Deep links work too:
`http://localhost:5173/?repo=gin-gonic/gin`.

### Optional: GitHub token

Without a token the GitHub API allows 60 requests/hour, which is enough for a few scans. GitHub Advisory
enrichment is capped at 40 advisories per scan; beyond that, OSV's mirrored copy of GitHub's severity is used. A token
raises the limit to 5,000/hour and enables full enrichment. Public read-only access is all it needs.

```bash
GITHUB_TOKEN=ghp_xxx mvn spring-boot:run
```

If the GitHub API limit is used up, the file listing falls back to jsDelivr's GitHub mirror, so nested manifests are still
found; only stars, description and license go missing until the limit resets.

---

## Deploy: Vercel (frontend) + Render (backend)

The frontend is a static Vite build, which suits Vercel. The backend is a long-running Spring Boot service that streams
progress over Server-Sent Events, so it runs on Render as a Docker web service rather than as serverless functions.

**1. Backend on Render**

1. In Render, choose **New > Blueprint** and select this repository. It reads [`render.yaml`](render.yaml), which builds
   [`backend/Dockerfile`](backend/Dockerfile) and checks `/api/health`.
2. Set `GITHUB_TOKEN` when prompted (optional but recommended). `ALLOWED_ORIGINS` defaults to
   `https://*.vercel.app,http://localhost:5173`; narrow it to your production domain if you like.
3. Note the service URL, for example `https://depjenga-api.onrender.com`.

**2. Frontend on Vercel**

1. Import the repository in Vercel and set **Root Directory** to `frontend`. The Vite preset's defaults
   (`npm install`, `npm run build`, `dist`) are right as they are; [`frontend/vercel.json`](frontend/vercel.json) only
   adds long-lived caching for the hashed assets.
2. Add the environment variable `VITE_API_URL` set to the Render URL from step 1 (no trailing slash), then deploy.

Render's free plan sleeps after about 15 minutes idle and takes up to a minute to wake. The page pings `/api/health`
as it opens to start that early; if a scan still loses its connection while the backend wakes, try again.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Vercel | Backend base URL. Unset in development, where Vite proxies `/api`. |
| `GITHUB_TOKEN` | Render | Raises the GitHub API limit to 5,000 requests/hour. |
| `ALLOWED_ORIGINS` | Render | Comma-separated CORS origins; wildcards such as `https://*.vercel.app` work. |
| `PORT` | Render | Set by Render automatically; defaults to 8080. |

See [`frontend/.env.example`](frontend/.env.example) and [`backend/.env.example`](backend/.env.example).

---

## How to play

| Key | Tool | What it does |
|---|---|---|
| `1` / `I` | Inspect | Click a block for its advisories, fix, bus-factor breakdown and path from your project |
| `2` / `P` | Pull | **Press and hold** a block until the ring fills; it slides out and the tower reacts with real physics |
| `3` / `B` | Blast radius | Click a block to light up every package that (transitively) depends on it |
| `D` | Detonate | With a blast radius selected, blow up that package and everything resting on it |
| `Q` | Quake | Shakes the table (a kinematic floor) |
| `R` | Restack | Rebuild the tower |
| `O` `G` `F` `S` | Panels | Risk dashboard · Dependency graph · Remediation · Data sources |
| `M` | Sound | Every click, knock and rumble is synthesized with WebAudio; haptics on supported phones |

**Reading the tower**

- **Color** = worst known advisory: critical / high / medium / low / *unscored advisory* / no known advisories.
- **Width** = maintainer & bus-factor risk. Thinner blocks mean more fragile maintenance, and the tower really is weaker there.
- **Hatching** = data unavailable. Nothing is estimated to fill the gap.
- **Bottom** = most depended-upon packages (the foundations).
- Up to 72 blocks. Larger trees keep vulnerable and direct packages in the tower; every package still appears in the dashboards and graph.

---

## Where the data comes from

DepJenga never makes up a finding. When a source has nothing, the UI says so.

| Question | Source | Notes |
|---|---|---|
| Which packages, which versions? | Lockfiles in the repo | `package-lock.json` (v1–v3), `yarn.lock` (classic + berry), `poetry.lock`, `Pipfile.lock`, `go.mod`, `Cargo.lock`, `Gemfile.lock`, `composer.lock`: exact installed tree |
| …when there's no lockfile? | `package.json`, `requirements*.txt`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `build.gradle` + **deps.dev** | Ranges resolve to the newest matching release; the transitive tree comes from deps.dev's resolver and is labeled *predicted*, not installed |
| Is this version vulnerable? | **OSV.dev** `querybatch` | Exact version match per package |
| How bad is it? | **GitHub Advisory Database** → GitHub severity mirrored in OSV → CVSS v3 base score computed from the advisory's vector → CVSS v3 of an aliased record | If none of these exist, the advisory is shown as **unscored**. Common for the Go vulnerability DB |
| Is there a fix? | OSV `affected[].ranges[].events.fixed` | The smallest fixed version above yours per advisory. The recommendation is **re-queried against OSV** so you don't upgrade into another known vuln |
| Bus factor / maintenance | **npm registry** (maintainer count), **OpenSSF Scorecard** via deps.dev (Maintained, Contributors, Code-Review), **deps.dev** (last release date, deprecation) | Score is normalized over the signals actually observed; no signals → no score |

### Collapse-risk score

`75%` vulnerability load + `25%` maintainer risk, graded A (under 15) · B (under 30) · C (under 47) · D (under 68) · F.

- **Vulnerability load:** critical 30 · high 15 · medium 6 · low 2 · unscored 5 points per vulnerable package, x0.35 if
  dev-only, x0.7 if a fixed version exists, x0.85 if transitive. Each further vulnerable package counts 7% less, and
  larger trees get a little more headroom before the curve saturates.
- **Maintainer risk:** the average bus-factor risk (direct dependencies weighted 2x), counted only above a baseline of 20,
  since most healthy ecosystems sit around 20-40. With no maintainer data the score is 100% vulnerability load.
- A runtime dependency with a critical advisory and no published fix holds the grade at D or worse.

"How is this calculated?" in the dashboard shows the breakdown for each scan.

---

## Architecture

```
frontend/  React 18 · TypeScript · Vite
  src/scene/        R3F scene: Rapier physics tower, bloom/outline post-processing, blast arcs, hold-to-pull
  src/components/   HUD, inspector, dashboard, d3-force graph, remediation, sources
  src/lib/          types, SSE client, tower layout, graph algorithms, WebAudio sound engine, physics bridge
  scripts/physics-sim.mjs   headless Rapier stability check for the stack

backend/   Spring Boot 3.3 · Java 21 (virtual threads)
  api/AnalyzeController       GET /api/analyze/stream (SSE progress + result), GET /api/analyze (JSON)
  manifest/                   ManifestSelector + parsers for every supported manifest/lockfile
  sources/                    GitHub, OSV, deps.dev, npm registry clients (per-host concurrency limits, retries, TTL caches)
  analysis/                   AnalysisService (orchestration), VulnerabilityService, RiskService, Scoring
  versions/                   npm/Cargo semver ranges, PEP 440 subset, CVSS v3.1 calculator
```

API:

```bash
curl "http://localhost:8080/api/analyze?repo=expressjs/express"
```

Add `&fresh=true` to bypass the 20-minute result cache.

### Physics notes

- Blocks are **dynamic bodies put to sleep on mount**, so the stack is perfectly still until something disturbs it.
- `erp` is set to `0.1`. `@react-three/rapier` defaults to `0.8`, which over-corrects resting contacts in a tall stack and blows it apart.
  `node frontend/scripts/physics-sim.mjs` shows the difference.
- Pulling temporarily lowers the pulled block's friction (combine rule *Min*), so it slides out like a carefully tapped
  Jenga block while the rest of the tower keeps real friction.

---

## Troubleshooting

- **Windows: "An Application Control policy has blocked this file … rollup.win32-x64-msvc.node"**: Smart App Control
  blocks Rollup's native binary. `frontend/package.json` already overrides Rollup with its official WASM build
  (`@rollup/wasm-node`), so `npm install` handles it.
- **"Rate limited" in Data sources**: add `GITHUB_TOKEN` (see above).
- **Monorepos**: up to 10 manifest groups and 600 packages are analyzed. Anything omitted is listed in the dashboard notes.

## Limits (by design, stated in the UI)

- `pnpm-lock.yaml` and Gradle version catalogs aren't parsed yet. The UI falls back to `package.json` ranges and says so.
- Maven versions inherited from an unfetched parent POM/BOM show as unresolved and aren't scanned.
- `go.mod` doesn't record which module pulls in an indirect dependency, so those attach to the project root.
- Advisory databases change daily. Re-scan before acting.

PRs welcome. Good first issues: a pnpm-lock parser, NuGet support, Gradle catalogs.
