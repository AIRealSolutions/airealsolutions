# Factory Integrations: Gmail, Google Calendar, GitHub, Vercel, Supabase

Page: **`/factory/connections`** (linked from My Factory and Admin).

## What it does
| Integration | Who | How it connects | What works now |
|---|---|---|---|
| Gmail | Every Factory user | "Connect Google" (their own account) | Send email from their Gmail, search and read recent inbox messages |
| Google Calendar | Every Factory user | Same Google connection | List upcoming events, create events and invite attendees |
| GitHub | Factory admins | `GITHUB_TOKEN` on the server | Connection check, list repositories |
| Vercel | Factory admins | `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`) | Connection check, list projects |
| Supabase | Factory admins | `SUPABASE_ACCESS_TOKEN` (Management API) | Connection check, list projects |

GitHub, Vercel and Supabase are the Factory's own accounts. The build pipeline (`docs/factory-build-pipeline-plan.md`) will use them to create repos, deployments and databases for customer projects. Next step: add create actions (create repo, create Vercel project, create Supabase project) to `app/lib/integrations/platform.ts`.

## Security
- Google tokens are encrypted on the server (AES-256-GCM, `INTEGRATIONS_ENCRYPTION_KEY`) before they are stored in `factory_user_integrations`. The database and browser only ever see ciphertext.
- Row-level security: each user can read and change only their own connection (`user_id = auth.uid()`).
- The OAuth `state` is HMAC-signed, expires after 10 minutes and is tied to the Factory user who started it.
- Platform tokens live only in Vercel environment variables, and the routes that use them check `factory_is_admin()`.
- Every email sent, event created and connect/disconnect is logged to `factory_integration_events`.
- Disconnecting revokes access at Google and deletes the stored token.

## Setup (one time)
### 1. Encryption key
Generate one (`openssl rand -base64 48`) and add it to Vercel as `INTEGRATIONS_ENCRYPTION_KEY` (Production and Preview).

### 2. Google Cloud OAuth client
1. https://console.cloud.google.com → create a project, for example "AI Real Solutions Factory".
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen**: External, app name "AI Real Solutions", support email, authorized domain `airealsolutions.com`. Add the scopes `gmail.send`, `gmail.readonly` and `calendar.events`. While the app is in **Testing**, add each person's Gmail address as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URIs:
   - `https://airealsolutions.com/factory/connections/google`
   - `http://localhost:3000/factory/connections/google` (local development)
5. Copy the client ID and secret into Vercel as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Google limits to know about:**
- In Testing mode, only listed test users (up to 100) can connect, and Google expires their access after 7 days, so they reconnect weekly.
- To open it to all customers, publish the app and complete Google verification. `gmail.readonly` is a *restricted* scope and needs a yearly security assessment. To avoid that, remove `gmail.readonly` from `GOOGLE_SCOPES` in `app/lib/integrations/google.ts`. Sending email and Calendar would keep working; only inbox reading would stop.

### 3. Platform tokens (admins)
- **GitHub**: Settings → Developer settings → Fine-grained token for the `airealsolutions` org. Permissions: Contents, Administration, Metadata, Pull requests. Save as `GITHUB_TOKEN`.
- **Vercel**: Account Settings → Tokens. Save as `VERCEL_TOKEN`; if projects are under a team, also set `VERCEL_TEAM_ID`.
- **Supabase**: https://supabase.com/dashboard/account/tokens. Save as `SUPABASE_ACCESS_TOKEN`.

Redeploy after adding environment variables.

## API routes (all need `Authorization: Bearer <Factory session token>`)
| Route | Purpose |
|---|---|
| `GET /api/integrations/status` | What is connected (platform status for admins) |
| `POST /api/integrations/google/start` | Returns the Google consent URL |
| `POST /api/integrations/google/exchange` | `{code,state}` from the callback page; stores encrypted tokens |
| `DELETE /api/integrations/google` | Disconnect and revoke |
| `GET /api/integrations/gmail?q=` | Recent messages (Gmail search syntax) |
| `POST /api/integrations/gmail` | `{to,subject,text}`: send |
| `GET /api/integrations/calendar` | Upcoming events |
| `POST /api/integrations/calendar` | `{summary,start,end,timeZone?,location?,description?,attendees?}` |
| `GET /api/integrations/platform?provider=github\|vercel\|supabase` | Admin: list resources |

Database: `docs/factory-integrations.sql` (applied as migration `factory_integrations`).
