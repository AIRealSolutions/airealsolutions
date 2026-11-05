# GolfBuddy → AI Real Solutions feature plan

Goal: bring GolfBuddy into airealsolutions.com as a feature for the weekly golf group. It is a light, fun tool that also shows friends what AI Real Solutions builds. It is not a commercial product line.

## 1. What exists today

**`AIRealSolutions/golfbuddy` repo** (unfinished, never built)
- `client/src/pages/WolfGame.tsx` + `WolfGame.css`: a single-page Wolf scorecard (setup → course select → hole-by-hole scoring → results).
- `api/index.ts` (Vercel function) and `server-index-golfbuddy.ts` (Express): two copies of the same REST API, which uses `pg` with `DATABASE_URL`.
- `vite.config.ts`, `vercel.json`. **There is no `package.json`**, so the Vercel deploy produced no output (see `VERCEL-FIX.md`).
- `db-schema-golfbuddy.sql`: the `golfbuddy` schema.

**Supabase (`xqdsmbyealtammgmpsqe`)**: the `golfbuddy` schema is **already applied**. It has 9 tables, RLS on, 1 course (Glen Dornach) with 18 holes, and no players, games or scores.

**airealsolutions.com**: Next.js 16 App Router. It already uses the same Supabase project (Factory login, publishable key, `factory` schema) and is deployed on Vercel.

### Problems found in golfbuddy
| # | Issue | Impact |
|---|---|---|
| 1 | **The Supabase service-role JWT is committed in `BUSINESS-SETUP.md`, and the repo is public** | Anyone can bypass RLS on the whole AIRealSolutions database, including Factory data. **Rotate now.** |
| 2 | `players` has a public-read RLS policy and holds `email` and `phone` | Friends' contact info could be read publicly once the schema is exposed |
| 3 | The API returns snake_case (`hole_number`), but the UI reads camelCase (`holeNumber`) | Hole numbers and par show as blank or undefined |
| 4 | The Wolf rotation is hard-coded to `idx % 3` with 3 players | Real Wolf is usually played with 4 |
| 5 | The scoring is only "wolf vs. each player" | There is no partner pick, Lone Wolf (2×) or Blind Wolf |
| 6 | The subtitle "Glen Dornach, SC" is hard-coded, and errors use `alert()` | Polish |
| 7 | Two API copies, no package.json, and `vercel.json` references `@secret` env syntax | Dead config; it won't be carried over |

## 2. Target architecture

```
airealsolutions.com/golf                 ← landing: "Golf Buddy by AI Real Solutions"
airealsolutions.com/golf/wolf            ← live Wolf scorecard (mobile-first, works on the course)
airealsolutions.com/golf/rounds/[id]     ← shareable round recap (OG image, "Powered by AI Real Solutions")
airealsolutions.com/golf/leaderboard     ← season standings
app/api/golf/*                           ← Next.js route handlers (server-only writes)
golfbuddy.airealsolutions.com            ← optional: GoDaddy CNAME → Vercel, redirects to /golf
```

- **One codebase, one Vercel project.** Retire Vite, Express, `pg` and the separate golfbuddy Vercel project.
- **Data:** keep the existing `golfbuddy` schema in the shared Supabase project. This is the same "shared incubator" pattern the Factory uses.
- **Reads** (courses, leaderboard, round recaps): go through `public` views (`golf_public_courses`, `golf_public_leaderboard`) like `factory_public_projects`, fetched server-side with the publishable key. Contact columns are never exposed.
- **Writes** (start round, save scores): go through `app/api/golf/*` route handlers that use `SUPABASE_SECRET_KEY` as a Vercel server env var. This key must never be `NEXT_PUBLIC_` and never committed.
- **Who can score:** reuse the existing Factory Supabase Auth login. Group members get a `golfbuddy.group_members` row, and the person keeping the card must be signed in. Viewing recaps and the leaderboard stays public (that is the promotion part).
- Move the hard-coded Supabase URL and key in the Factory files to `NEXT_PUBLIC_*` env vars while touching this area (optional cleanup).

## 3. Phased plan

### Phase 0 — Security (do first, ~30 min)
1. In Supabase, go to Settings → API, **roll the service-role/secret key** (or JWT secret), and update any Vercel envs that use it.
2. Delete `BUSINESS-SETUP.md`'s key and `vercel.json` env block from golfbuddy. A rotated key makes history harmless, so a history rewrite is optional.
3. Migration: drop `"Allow public read"` on `golfbuddy.players`, and add a `public.golf_public_players` view (id, name, handicap) instead.

### Phase 1 — Port the scorecard (no DB writes yet)
1. Create `app/golf/page.tsx` as the landing page: what it is, a "Start a Wolf round" CTA, and a soft promo block ("Built by AI Real Solutions — we build tools like this for businesses").
2. Create `app/golf/wolf/WolfScorecard.tsx` (`"use client"`), ported from `WolfGame.tsx`:
   - Map DB rows → camelCase in one place (fixes #3).
   - Support 3–5 players, with the rotation `players[idx % players.length]` (fixes #4).
   - Add real Wolf rules: after the tee shots the wolf picks a partner or goes Lone Wolf. Use configurable points (default: team win 1 each, Lone Wolf 2×/3× per opponent).
   - Save the in-progress round to `localStorage`, so a phone lock or dead zone on the course doesn't lose the card.
   - Use a big-tap-target mobile layout in the site's existing CSS style (CSS module, no new deps).
3. Load the courses server-side from `golf_public_courses` (Glen Dornach is already seeded).
4. Add Golf to the nav/footer and `sitemap.ts`, and a "Community" card on `/products` (internal link to `/golf`).

### Phase 2 — Save rounds and the leaderboard
1. Migration: `golfbuddy.group_members (user_id → auth.users, player_id)`, plus columns on `games` for `format='wolf'` and `settings jsonb`.
2. Route handlers: `POST /api/golf/rounds`, `PUT /api/golf/rounds/[id]/holes/[n]`, and `POST /api/golf/rounds/[id]/finish`. Finishing a round writes `game_results` and updates `yearly_leaderboards`.
3. Add `/golf/leaderboard` (season points, rounds played, Lone Wolf wins).
4. Add `/golf/rounds/[id]`: a recap page with a dynamic OG image (`opengraph-image.tsx`), so a text or group-chat link shows a branded card. **This is the main promotional hook.**

### Phase 3 — Optional extras
- An AI round recap (Claude writes a short, funny summary of the round for the group chat).
- More courses: add a course by entering the scorecard, or by uploading a photo that AI extracts.
- More games: Skins, Nassau, Stableford (same scoring engine).
- Subdomain `golfbuddy.airealsolutions.com`: add it in Vercel, then add a GoDaddy CNAME → `cname.vercel-dns.com` with a redirect to `/golf`.

### Phase 4 — Retire the old repo
Archive `AIRealSolutions/golfbuddy` on GitHub, with a README pointer to `airealsolutions.com/golf`. Remove the old Vercel project if one was created.

## 4. Files touched in airealsolutions
```
app/golf/page.tsx, golf.module.css
app/golf/wolf/page.tsx, WolfScorecard.tsx, wolf-scoring.ts (pure functions, easy to test)
app/golf/leaderboard/page.tsx                  (phase 2)
app/golf/rounds/[id]/page.tsx, opengraph-image.tsx (phase 2)
app/api/golf/**/route.ts                       (phase 2)
app/products/page.tsx, app/sitemap.ts, nav in page headers
docs/golfbuddy-database.sql                    (migrations, matching docs/factory-database.sql)
```

## 5. Decisions needed from Marc
1. Who keeps score: **signed-in group members only** (recommended), or anyone with a link or PIN?
2. Is the leaderboard **public** (more promo value), or for the group only?
3. Should the round recaps carry Lightkeeper Realty / USA HUD Homes branding too, or only AI Real Solutions?
4. Do you want the `golfbuddy.airealsolutions.com` subdomain, or is `/golf` enough?
