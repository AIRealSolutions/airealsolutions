# Factory authentication and Resend SMTP setup

The Factory uses Supabase Auth. Normal sign-in is email + password. Email is only required for account confirmation and password recovery.

## Application configuration

Browser-safe Vercel variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://xqdsmbyealtammgmpsqe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
NEXT_PUBLIC_FACTORY_AUTH_REDIRECT=https://airealsolutions-aw3l.vercel.app/login
```

Never put a Supabase secret/service-role key or Resend API/SMTP password in a `NEXT_PUBLIC_` variable. If the auth redirect variable is omitted, the login page uses the current deployment origin plus `/login`.

## Supabase URL configuration

Until the custom domain is switched over:
- Site URL: `https://airealsolutions-aw3l.vercel.app`
- Redirect URL: `https://airealsolutions-aw3l.vercel.app/login`

Add the final production callback before changing the Site URL.

## Resend SMTP

1. Create and verify a sending domain in Resend. Prefer an authentication subdomain such as `auth.airealsolutions.com`.
2. Add the DNS records supplied by Resend.
3. Create SMTP credentials in Resend.
4. In Supabase > Authentication > SMTP Settings, enable custom SMTP and enter the host, port, username and password supplied by Resend.
5. Use a sender such as `AI Real Solutions <no-reply@auth.airealsolutions.com>`.
6. In Supabase > Authentication > Rate Limits, choose a conservative initial email limit and increase it as real Factory usage requires.
7. Send one password-recovery test from the Factory login page. Verify the link lands on `/login`, permits a new password, and then opens `/factory/dashboard`.

Resend credentials belong in Supabase SMTP settings, not in this repository and not in the browser.

## Email templates

Keep authentication messages short and transactional. Password recovery should clearly identify the action and contain one reset link. Do not mix marketing content into authentication emails.
