# AI Interview Prep Kit — Backend

Turns a job description + company URL into a structured interview prep kit (Appendix A).

**API:** [https://api-trao.malviya.cloud](https://api-trao.malviya.cloud) · **App:** [https://www.trao.malviya.cloud](https://www.trao.malviya.cloud) · **Repo:** [https://github.com/Atmalviya/trao-backend](https://github.com/Atmalviya/trao-backend)

---

## Overview

Express API + generation pipeline. Users auth via session cookies, create kits through the web UI or batch CLI. Research is real: company sites are crawled, public interview discussion is searched, and the kit is built through deliberate sequential steps — not one mega-prompt.

**Stack:** Node.js 20 · Express 5 · TypeScript · MongoDB Atlas · Gemini (+ Groq fallback) · cheerio · Zod · Vitest

---

## Setup

**Local**

```bash
npm install && cp .env.example .env
npm run dev          # :4000
npm test             # 94 tests
```

**Deployed:** Coolify (Docker) → [https://api-trao.malviya.cloud](https://api-trao.malviya.cloud)

**Batch (Section 9)**

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Env vars: see `[.env.example](./.env.example)`.

---

## LLM


|          | Provider      | Model                     |
| -------- | ------------- | ------------------------- |
| Primary  | Google Gemini | `gemini-2.5-flash`        |
| Fallback | Groq          | `llama-3.3-70b-versatile` |


Shared rate-limit queue (5 RPM default, backoff on 429). Batch cases run sequentially.

---

## Pipeline


| Step                       | Owner      | Does                                                      |
| -------------------------- | ---------- | --------------------------------------------------------- |
| `extract_requirements`     | LLM        | JD → `r1…rn` (must/nice). Conservative.                   |
| `crawl_company_site`       | Code       | Rank links, crawl, find hiring page. Skip if unreachable. |
| `search_public_discussion` | Code       | AmbitionBox → Tavily → DDG → skip.                        |
| `company_brief`            | LLM        | Summary from fetched pages.                               |
| `generate_questions`       | LLM        | One call per category, weighted by hiring format.         |
| `generate_flashcards`      | LLM        | Cards linked to requirement ids.                          |
| `coverage_check`           | Code + LLM | Gap detection + fill (max 3 passes).                      |
| `allocate_schedule`        | Code       | Exactly N days. Pure arithmetic.                          |
| `validate_kit`             | Code       | Zod vs Appendix A.                                        |


**Retrieval:** No hard-coded paths. Respects robots.txt. Untrusted text wrapped in injection guards.

**Coverage:** Deterministic set check in code. Uncovered must-haves recorded honestly — never invented.

---

## Architecture

**High-level**

```mermaid
flowchart TB
  subgraph clients [Clients]
    UI[Next.js UI]
    CLI[Batch CLI]
  end

  subgraph api [Express API]
    RC[routes → controllers → services]
  end

  subgraph core [src/core — shared by API and CLI]
    GK[generateKit]
    RET[retrieval — crawl, search, fetch]
    PIPE[pipeline — extract, brief, questions, flashcards]
    COV[coverage — gap check + fill]
    SCH[scheduler — day allocation]
    GK --> RET --> PIPE --> COV --> SCH
  end

  subgraph external [External]
    DB[(MongoDB)]
    LLM[Gemini / Groq]
    WEB[Company websites]
    DISC[AmbitionBox · Tavily · DDG]
  end

  UI -->|REST + SSE| RC
  CLI --> GK
  RC --> GK
  RC --> DB
  RET --> WEB
  RET --> DISC
  PIPE --> LLM
```

`src/core/` has no Express imports — web app and `npm run evaluate` run the same pipeline.

**Kit generation pipeline** (`src/core/generateKit.ts`)

```mermaid
flowchart TD
  START([Input: jd · company_url · days]) --> S1

  subgraph step1 [1 · extract_requirements]
    S1[LLM: parse JD] --> R1[requirements r1…rn<br/>must/nice · kind]
  end

  START --> S2
  subgraph step2 [2 · crawl_company_site]
    S2[Code: crawl site] --> V1[URL guard · robots.txt]
    V1 --> V2[Link rank · best-first fetch]
    V2 --> P1[about + hiring pages]
    S2 -.->|unreachable| N1[skip · note]
  end

  START --> S3
  subgraph step3 [3 · search_public_discussion]
    S3[Code: search chain] --> AB[AmbitionBox / Apify]
    AB --> TV[Tavily]
    TV --> DDG[DuckDuckGo]
    DDG --> N2[skip · note]
  end

  R1 --> S4
  P1 --> S4
  subgraph step4 [4 · company_brief]
    S4[LLM: summarise pages] --> B1[company_brief]
  end

  R1 --> S5
  P1 --> HC[deriveHiringContext]
  S3 --> HC
  HC --> S5
  subgraph step5 [5 · generate_questions]
    S5[LLM: one call per category] --> Q1[technical]
    S5 --> Q2[behavioural]
    S5 --> Q3[system-design]
    S5 --> Q4[company-fit]
  end

  R1 --> S6
  B1 --> S6
  subgraph step6 [6 · generate_flashcards]
    S6[LLM] --> F1[flashcards f1…fn]
  end

  Q1 & Q2 & Q3 & Q4 --> S7
  subgraph step7 [7 · coverage_check]
    S7[Code: checkCoverage] --> GAP{uncovered reqs?}
    GAP -->|yes · pass ≤ 3| S7L[LLM: generateGapQuestions]
    S7L --> S7
    GAP -->|no · or max passes| S8
  end

  START --> S8
  subgraph step8 [8 · allocate_schedule]
    S8[Code: must-first · hardest-first<br/>split into N days · integer minutes] --> SCH[schedule]
  end

  R1 & B1 & Q1 & Q2 & Q3 & Q4 & F1 & SCH --> S9
  subgraph step9 [9 · validate_kit]
    S9[Code: Zod + referential checks] --> OUT([Appendix A kit])
  end

  OUT -.->|web app · optional| S10
  subgraph step10 [10 · analyze_resume_fit]
    S10[LLM: map resume → r1…rn] --> FIT[resumeFit report]
  end

  style S1 fill:#e8f4fc
  style S4 fill:#e8f4fc
  style S5 fill:#e8f4fc
  style S6 fill:#e8f4fc
  style S7L fill:#e8f4fc
  style S10 fill:#e8f4fc
  style S2 fill:#f0f0f0
  style S3 fill:#f0f0f0
  style S7 fill:#f0f0f0
  style S8 fill:#f0f0f0
  style S9 fill:#f0f0f0
```

Blue = LLM steps · Grey = deterministic code · Dashed = non-fatal skip or optional path.

**End-to-end request flow**

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as Frontend
  participant API as Express API
  participant GK as generateKit
  participant RET as Crawl / Search
  participant LLM as Gemini
  participant DB as MongoDB

  U->>FE: JD + company URL + days
  FE->>API: POST /kits
  API->>DB: create kit + GenerationJob
  API-->>FE: kit id
  API->>GK: async run

  GK->>LLM: extract_requirements
  GK->>RET: crawl_company_site
  GK->>RET: search_public_discussion
  GK->>LLM: company_brief
  GK->>LLM: generate_questions (per category)
  GK->>LLM: generate_flashcards

  loop coverage — max 3 passes
    GK->>GK: checkCoverage (code)
    alt gaps remain
      GK->>LLM: generateGapQuestions
    end
  end

  GK->>GK: allocate_schedule (code)
  GK->>GK: validate_kit (Zod)
  GK->>DB: save kit (status ready)

  par SSE progress
    GK-->>API: step updates
    API-->>FE: GET /kits/:id/events
  end

  FE-->>U: Kit ready

  opt resume uploaded
    GK->>LLM: analyze_resume_fit
    GK->>DB: save resumeFit
  end
```

---

## Builder state

Questions/flashcards carry `origin` (`generated` | `edited` | `manual`) and `pinned`.

Category regen replaces only **generated + unpinned** items. Edited, manual, and pinned survive.

---



## Schedule

Code in `scheduler.ts`: must-haves first → hardest first → split into N days → integer minutes (15/25/40 by difficulty). Extra days = review.

---



## Creative feature: Resume fit

Optional upload (PDF/DOCX/TXT/MD) → per-requirement gap/strength report vs `r1`, `r2`, … Prep intelligence only, not CV rewriting. Non-blocking.

---



## Trade-offs & limitations

- Practice: confidence-weighted sort (unseen → weakest → oldest)
- No headless browser · in-process SSE jobs · max 3 coverage passes
- Partial research → `status: "ok"` with honest notes; `failed` only when no kit produced
- Free-tier RPM is the main batch bottleneck

