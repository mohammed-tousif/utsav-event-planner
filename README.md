# Utsav: a GenAI planner for weddings, birthdays and community events

Utsav turns a few answers about an event into a plan you can actually work from: a budget split, a dated timeline, a vendor checklist with questions to ask, and ideas that fit the guests, the style and the money. Then you can change the plan in plain English ("reduce the budget by 20%", "keep the venue budget unchanged but reduce decoration costs", "the event is now next week") and see exactly what moved.

**Live app:** https://utsav-event-planner.onrender.com
(free hosting: the first request after a quiet period can take about a minute while the server wakes up)

## Challenge

PromptWars Virtual, Challenge 5: **Celebration & Event Planner**.
*"Create a GenAI-powered planning assistant that helps users organize weddings, birthdays, and community events with budgets, timelines, vendor checklists, and personalized ideas."*

| Requirement | Where it lives in Utsav |
| --- | --- |
| Weddings, birthdays, community events | Event type is the first choice; each type has its own follow-up questions, budget categories and vendor checklist |
| Budgets | Budget tab: amounts, shares, contingency, per-guest cost, locks, trade-offs, tight-budget warnings |
| Timelines | Timeline tab: preparation tasks with due dates and priorities, plus the event-day run sheet |
| Vendor checklists | Vendors tab: every vendor the event needs, why, questions to ask, what to compare, red flags, status and quotes |
| Personalized ideas | Ideas tab: ideas with an explicit "why it fits", an estimated cost and the budget line it would come from |

## How it works

```
Browser (React)                     Server (Express)                      Google Gemini
──────────────                      ────────────────                      ─────────────
Intake form ── validated input ──▶  POST /api/plans
                                    zod validation, date check
                                    prompt built from structured data ──▶ structured JSON (schema-constrained)
                                    zod validation of the reply  ◀─────── draft: weights, tasks, schedule,
                                    deterministic engine                   vendor guidance, ideas
Plan workspace ◀── complete plan ── (budget maths, dates, merging)

"Reduce the budget by 20%" ──────▶  POST /api/plans/revise
                                    current plan + request ─────────────▶ what should change
                                    exact numbers parsed in code ◀─────── locks, weight changes,
                                    engine recalculates everything         regenerated sections
Band animates old → new ◀── plan + diff
```

**The split of responsibilities is the core idea.** Gemini decides *what* a good plan looks like for this event (which categories deserve more weight and why, which tasks matter, what to ask vendors, which ideas fit). The app decides *how much* and *when*: every rupee and every date is computed in TypeScript, so totals always add up, nothing goes negative, and a "kept" category never moves.

### Approach and logic

1. **Intake.** Five short steps: basics, budget and priorities, event-specific follow-up questions (wedding functions and days; whose birthday and who is coming; community event format, setting and entry), style and preferences, then a review step that flags anything unusual (short notice, no venue a month out, a tight budget per guest, a likely extra zero) before any AI call.
2. **Generation.** The server sends Gemini a prompt assembled from validated fields, with every free-text field wrapped in `<user_text>` tags that the system instruction says to treat as information only. Gemini returns JSON constrained by a JSON Schema derived from the same zod schema the server validates against.
3. **Deterministic engine** (`src/shared`):
   - **Budget:** each event type has base category weights calibrated for a reference guest count. Weights scale with guests (food scales linearly, a priest's fee not at all), get a boost for the user's top priorities, and are multiplied by Gemini's adjustment factors, clamped to 0.5–1.6. Amounts are rounded to tidy steps and the rounding remainder goes to contingency, so lines + contingency equal the total exactly.
   - **Timeline:** Gemini gives each task an ideal "days before the event". If the event is sooner than that, tasks are compressed into the time left, keeping their order, and marked "brought forward". Dates never fall in the past or after the event.
   - **Vendors:** a standard checklist per event type guarantees nothing is missed; Gemini's guidance is merged in per category and labelled as such. Booking-by dates come from typical lead times, compressed the same way.
   - **Ideas:** each idea's cost is checked against the budget line it would come from.
4. **Revisions.** Gemini returns what should change (new total, guests, date, categories to keep or adjust, sections to rewrite). The app then:
   - reads exact numbers from the request itself ("by 20%", "from 50 to 80", "12 lakh") and uses those over the model's arithmetic;
   - treats a single-category request ("reduce decoration costs") as targeted: only that line changes and the difference goes to or from contingency;
   - rebalances everything (respecting locks) when the total or guest count changes;
   - re-dates tasks and vendor deadlines when the date moves, keeping completed tasks;
   - refuses impossible changes (locks bigger than the new total, past dates) with a clear message instead of overspending.
   Each revision is stored with what was asked, what Gemini understood, the trade-offs and a before/after diff, and the budget band animates from the old split to the new one.
5. **Direct edits without AI.** Guests, total budget, contingency and per-category locks can be changed directly; the same engine recalculates instantly with no AI call.

## Features

- Three event types with type-specific questions, budget categories and vendor checklists
- Live "invitation" summary while filling the form; plausibility checks before generating
- Budget band, the plan's signature element, that animates where money moved after each change
- Budget table with shares, per-guest cost, contingency, locks, deltas and trade-offs
- Preparation tasks grouped by phase with due dates, priorities, completion and progress
- Event-day schedule grouped by function or day, with overlap warnings
- Vendor checklist with status tracking, your own quotes checked against the budget, notes
- Ideas with "why it fits", estimated cost, budget fit and effort
- Natural-language revisions with suggestions, cancel, and a change history
- Saved automatically in the browser; export as a plan file (re-importable), a calendar file (.ics) or print/PDF
- Light and dark themes, keyboard support, reduced-motion support, mobile layout

## GenAI usage

| | |
| --- | --- |
| Provider | Google Gemini API (`@google/genai` SDK), called only from the server |
| Models | `gemini-3.8-flash` first, then `gemini-3.6-flash` and `gemini-3.5-flash-lite` as fallbacks when a model is overloaded, rate-limited or returns unusable output (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`) |
| Plan generation | Budget weighting with reasons, contingency suggestion, trade-offs, 12–22 preparation tasks, event-day schedule, tailored vendor guidance, 4–6 personalized ideas, assumptions |
| Revision | Interprets the change request against the current plan: new values, locks, weight changes, which sections to rewrite, a change summary and trade-offs |
| Output control | JSON output constrained by a JSON Schema generated from the server's zod schemas. If a model rejects a request style, the next one is tried (simplified schema, full schema with a thinking level, then plain JSON with the schema in the prompt) and the rejected style is remembered. Every reply is repaired for small deviations (numbers as text, 12-hour times) and then validated with zod before the engine uses it |
| Resilience | One retry on malformed output; overloaded models skipped for 2 minutes and rate-limited ones for 10; identical generate requests cached for 30 minutes |

Which model wrote a plan is shown on the plan itself and in its print/PDF version.

**Verified on the live deployment** (23 October 2026): real plan generation and real revisions ("keep the venue budget unchanged but reduce decoration costs" kept the venue fixed, cut decor and moved the difference to contingency with the total unchanged). During testing the free-tier `gemini-3.8-flash` and `gemini-3.6-flash` were returning "high demand" errors, so plans came from the `gemini-3.5-flash-lite` fallback.

If the server has no API key in development, it uses **sample data**: fixed placeholder content that is clearly labelled in the header and on the plan and is never presented as AI output. Production never falls back to sample data silently; it reports that AI is not configured.

## Security

- The Gemini key lives only in the server environment; a test and a build script check that it never reaches the browser bundle
- Strict Content Security Policy (no inline scripts or styles, no third-party origins), `frame-ancestors 'none'`, no referrer, Permissions-Policy, HSTS (Helmet)
- Every request body validated with zod; 200 KB body limit; per-IP rate limit on AI routes; client date sanity check
- User text and model output treated as untrusted: control and zero-width characters stripped, lengths capped, rendered only as text (an ESLint rule forbids `dangerouslySetInnerHTML`)
- Prompt-injection hardening: user text wrapped and delimiters stripped; the model cannot change amounts or dates directly, only suggest bounded adjustments that the engine validates
- Errors return safe messages; logs contain only route, status, model and timing, never plans or keys

## Accessibility

- Semantic structure, labelled controls, fieldsets for choice groups, errors linked with `aria-describedby`, focus moved to the first invalid field
- WAI-ARIA tabs with arrow, Home and End keys; visible focus everywhere; skip link
- Live regions announce generation, revision results and errors
- Colour is never the only signal (icons, text and patterns carry meaning); contrast checked for both themes
- `prefers-reduced-motion` removes the band animation and other motion
- Automated axe-core checks in the end-to-end tests

## Efficiency

- One AI call per plan and one per revision in the normal case; identical generate requests are cached for 30 minutes, and request styles or models known to fail are skipped instead of retried
- Direct edits (guests, budget, contingency, locks) are recalculated in the browser with no network call
- Single small server, gzip compression, immutable caching for hashed assets, self-hosted variable font

## Testing

```bash
npm test          # 151 unit and API tests (Vitest + Supertest)
npm run test:e2e  # 10 end-to-end tests in Chromium (Playwright), desktop and mobile
npm run check     # typecheck + lint + unit/API tests + build + secret scan
```

Covered: budget totals and rounding for every event type, locks and infeasible locks, tight and implausible budgets, past, same-day and next-week dates, task compression, schedule overlaps, every example revision request, exact parsing of percentages and guest counts, malformed and truncated AI output, repair of near-miss JSON, retries, request-style stepping, model fallback, overload and quota cooldowns, provider error mapping with redacted diagnostics, prompt-injection wrapping, input validation, rate limiting, payload limits, security headers, saved-plan recovery, import and export, print output, keyboard navigation, mobile layout and axe accessibility scans. End-to-end tests run against the production build in sample-data mode so they are repeatable; the real Gemini flow was verified on the deployed app.

## Running locally

Requires Node.js 22 or later.

```bash
npm install
cp .env.example .env      # add your GEMINI_API_KEY from https://aistudio.google.com/apikey
npm run build
npm start                 # http://localhost:8080
```

For development with hot reload: `npm run dev` (API on 8080, UI on 5173). Without a key, development uses labelled sample data.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Gemini API key (server only) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Primary model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.6-flash,gemini-3.5-flash-lite` | Comma-separated models tried in order when the primary is overloaded, rate-limited or unavailable |
| `GEMINI_THINKING_LEVEL` | `LOW` | `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` or `OFF` |
| `GEMINI_TIMEOUT_MS` | `60000` | Per-call timeout |
| `AI_PROVIDER` | auto | `sample` forces labelled sample data |
| `RATE_LIMIT_MAX_AI` / `RATE_LIMIT_WINDOW_MS` | `12` / `900000` | AI requests allowed per IP per window |
| `PORT` | `8080` | HTTP port |

## Deployment

The app is one Node service that serves both the API and the built UI. `render.yaml` describes it for Render: build with `npm ci --include=dev && npm run build`, start with `npm start`, and set `GEMINI_API_KEY` as a secret in the dashboard. Any Node 22 host works the same way.

## Project structure

```
src/
  shared/    domain logic used by server and browser: schemas, budget engine,
             timeline scheduling, vendor catalogue, revision engine, intake checks
  server/    Express app, Gemini provider, prompts, JSON Schema conversion, config
  client/    React UI: intake, plan workspace, budget band, tabs, export, storage
tests/
  unit/      engine, schemas, prompts and Gemini provider tests
  api/       HTTP tests with Supertest
  e2e/       Playwright journeys, accessibility and mobile checks
```

## Assumptions and limitations

- Costs are estimates based on Indian price levels for INR plans. Other currencies work, but tight-budget warnings only apply to INR.
- Utsav does not search, list, rate or verify real vendors, and does not check availability or prices. The vendor checklist tells you what to look for; you record real quotes yourself.
- Plans are stored in your browser's local storage. Nothing is stored on the server; clearing browser data deletes saved plans, so export a plan file to keep a copy. Event details you enter are sent to Google Gemini to draft the plan.
- Free-tier Gemini capacity is limited: when the primary models are overloaded or out of quota, the lighter fallback model writes the plan, and if every model is unavailable the app says so and asks you to wait. A plan usually takes 10 to 45 seconds.
- The event-day schedule covers the main event; multi-day weddings group items by function rather than giving every day its own date.
- Interface text is in English.

## License

MIT
