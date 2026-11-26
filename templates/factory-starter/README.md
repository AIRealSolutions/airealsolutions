# Factory starter

The starting point for every product the AI Real Solutions Factory builds: **Next.js 16 + Supabase
(auth, row-level security) + Resend**, drawn from a `site.json` Site Spec. Out of the box it is a
working site: every page in `site.json`, forms that save, a staff-only dashboard, and an email to the
owner on each new submission. The Factory's Code Agent then builds the product's own features on top.

The same Site Spec drives the Factory's instant preview (`/preview/<slug>`), so the approved prototype
and the real site start out identical.

## Run it
```bash
npm install
cp .env.example .env.local   # fill in Supabase (and Resend) to connect forms and sign-in
npm run dev
```
Without Supabase settings the site still renders; forms and sign-in say they are not connected yet.

## Database
Apply `supabase/migrations/*.sql` to the project's Supabase database, then add the owner:
```sql
insert into public.site_members(email, role) values ('owner@theirbusiness.com', 'owner');
```
In Supabase Auth, set the Site URL and add `<site>/auth/callback` to the redirect URLs.

## Checks (all must pass before a build is handed over)
| Command | What it proves |
|---|---|
| `npm run typecheck` | TypeScript is clean |
| `npm run test:unit` | `site.json` is valid (nothing silently dropped) and the Site Spec rules hold |
| `npm run build` | Production build succeeds |
| `npm run test:smoke` | Playwright, desktop and phone: every page loads with no errors and no sideways scrolling, navigation works, 404s work, every form fills and sends, the form API refuses bad input, dashboards are hidden from visitors |
| `npm run test:rls` | Row-level security: visitors can only submit, non-members see nothing, staff can read and set status, only owners manage members and delete. Uses a throwaway local Postgres, or `DATABASE_URL` (a Supabase branch) |
| `npm run check` | typecheck + unit + build + smoke, in that order |

Smoke tests are generated from `site.json`, so they follow the site as it changes. With
`NEXT_PUBLIC_SUPABASE_URL` set they also expect forms to save for real.

## Environment
See `.env.example`. Server-only: `RESEND_API_KEY`. Browser-safe: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Keeping in step with the Factory
`lib/site-spec.ts` is a copy of `app/lib/site-spec.ts` in the Factory repo (only the header comment
differs). Change both together.

## Making it the GitHub template
This folder lives in the Factory repo at `templates/factory-starter/`. To have new projects start from it:
copy it to its own repository, mark that repository as a template on GitHub, and set the Factory's
`GITHUB_TEMPLATE_REPO` to `owner/repo`. Project provisioning then generates each project's repo from it.
