# AI Interview Prep Kit

Web app + API that turns a job description and company URL into a personalised interview prep kit (Appendix A). Pairs with the repo.

**Deployed** **Frontend:** *(URL) -* 

## Tech stack


| Layer    | Choice                                      | Justification                              |
| -------- | ------------------------------------------- | ------------------------------------------ |
| Frontend | Next.js 15 + Tailwind CSS 4                 | Prescribed stack                           |
| Backend  | Node.js + Express 5 + TypeScript            | Prescribed stack                           |
| Database | MongoDB (Mongoose)                          | Prescribed stack                           |
| LLM      | Gemini `gemini-2.5-flash` (+ Groq fallback) | High free-tier TPM; Groq on 429/failure    |
| Scraping | cheerio + robots-parser                     | No headless browser; fast for batch window |
| Search   | AmbitionBox (Apify) → Tavily → DuckDuckGo   | Public interview discussion; graceful skip |


Hand-rolled pipeline (no LangChain) so step sequencing and rate-limit control stay explicit.

## Setup



### Local

```bash
npm install
cp .env.example .env   # set MONGODB_URI, SESSION_SECRET, GEMINI_API_KEY, WEB_ORIGIN
npm run dev            # http://localhost:4000
```

Start the frontend separately (`NEXT_PUBLIC_API_URL=http://localhost:4000`). 

### Deployed

- **API:** Render - `npm install && npm run build`, start `npm start`. Env vars from `.env.example`. Set `NODE_ENV=production`, `WEB_ORIGIN` to frontend URL. Do not set `ALLOW_PRIVATE_NETWORKS` in production.
- **Database:** MongoDB Atlas M0.
- **Frontend:** Vercel with `NEXT_PUBLIC_API_URL` pointing at the API.



### Batch entry point

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Run for the Live sites

```bash
npm run evaluate -- --input fixtures/cases.live-example.json --output fixtures/output/live-kits.json
```

Example with local fixture sites:

```bash
npm run fixtures   #First serves mock company sites on :8099 

ALLOW_PRIVATE_NETWORKS=true npm run evaluate -- --input fixtures/cases.local-example.json --output fixtures/output/local-kits.json
```

Runs the same `generateKit` pipeline as the web app. Input/output shapes: Appendix B. Continues after per-case failure.

## LLM provider and model

- **Primary:** Google Gemini - `gemini-2.5-flash` (override via `GEMINI_MODEL`)
- **Fallback:** Groq - `llama-3.3-70b-versatile`

All calls share a rate-limit queue (default 5 RPM, exponential backoff on 429). Batch cases run sequentially.

## Architecture

```
Next.js UI ──▶ Express API (routes → controllers → services) ──▶ MongoDB
                      │
                      ▼
               src/core/generateKit
               (pipeline, crawl, search, coverage, scheduler)
                      ▲
               scripts/evaluate.ts (batch CLI)
```

`src/core/` has no Express imports - API and batch CLI share the same generation code.

Generation is async: `GenerationJob` tracks steps, progress streams via SSE. Duplicate JD+URL per user is deduped via `inputHash`.

## Retrieval approach and sources

**Company site:** Validate URL (SSRF guard in production) → fetch homepage → rank links by anchor/URL signals (no hard-coded paths) → best-first crawl → respect **robots.txt** → rate-limit per host. Page failures are non-fatal.

**Public discussion** (first hit wins): AmbitionBox via Apify → Tavily → DuckDuckGo → skip with honest note.

Untrusted page text is treated as data, not instructions, before LLM use.

## Research and generation sequence


| Step                       | Owner      | Responsibility                                                                                                           |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `extract_requirements`     | LLM        | JD → requirements `r1…rn` (must/nice, kind). Conservative - no invented reqs.                                            |
| `crawl_company_site`       | Code       | Find about + hiring pages; skip if unreachable.                                                                          |
| `search_public_discussion` | Code       | AmbitionBox → Tavily → DDG → skip.                                                                                       |
| `company_brief`            | LLM        | Brief from fetched pages.                                                                                                |
| `generate_questions`       | LLM        | **One call per category**, weighted by hiring format found.                                                              |
| `generate_flashcards`      | LLM        | Flashcards linked to requirement ids.                                                                                    |
| `coverage_check`           | Code + LLM | Gap detection + fill loop (max **3 passes**); stops early if model adds nothing. Uncovered must-haves recorded honestly. |
| `allocate_schedule`        | Code       | Distribute across exactly N days.                                                                                        |
| `validate_kit`             | Code       | Zod validation against Appendix A.                                                                                       |


Schedule allocation and coverage checking are deterministic code, not LLM prompts.

## Generated, edited, and pinned state

Each question/flashcard carries `origin` (`generated` | `edited` | `manual`) and `pinned` (boolean).

Regenerating a category replaces only **generated + unpinned** items in that category. Edited, manual, and pinned items survive. Other sections are untouched.

## Schedule allocation

Pure code in `scheduler.ts`:

1. Order questions: must-have coverage first, then highest difficulty.
2. Split into exactly `days_available` contiguous chunks (heavier days first).
3. Each day: focus, question ids, integer minutes (difficulty 1→15, 2→25, 3→40 min).
4. Extra days become review days revisiting hardest questions.



## Creative feature: Resume fit

Optional resume upload (PDF, DOCX, TXT, MD) maps the candidate's experience to extracted requirements (`r1`, `r2`, …) with per-requirement `strong` / `partial` / `gap` status and focus areas. Prep intelligence only - not CV rewriting. Non-blocking; stored outside Appendix A export.

## Design decisions, trade-offs, and limitations

**Practice mode:** Confidence-weighted ordering - unseen cards first, then lowest confidence, then least-recently seen. Chosen over spaced repetition for simplicity and determinism.

**Edge cases:** Unreachable URLs, missing hiring pages, thin JDs, and empty search results produce honest partial kits (`status: "ok"`), not fabricated content. `status: "failed"` only when no kit can be produced. LLM 429 → backoff + Groq fallback. Invalid JSON → one repair attempt, then fallback provider.

**Trade-offs:** No headless browser (JS-only sites may crawl thin). In-process jobs + SSE (no Redis). Max 3 coverage passes (balance vs 15-min batch budget).

**Limitations:** Free-tier LLM RPM is the main batch bottleneck. AmbitionBox match depends on company name + role title. JS-rendered sites may yield limited crawl data.