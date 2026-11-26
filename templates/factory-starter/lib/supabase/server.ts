// Supabase client for Server Components, Route Handlers and Server Actions, acting as the visitor
// (their session cookie, or anonymous). Row-level security decides what they can see.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL, hasSupabase } from "./env";

export async function supabaseServer() {
  if (!hasSupabase()) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes the session.
        }
      },
    },
  });
}

/** The signed-in user (verified with Supabase Auth), or null. */
export async function currentUser() {
  const sb = await supabaseServer();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** Is the signed-in user listed in site_members? */
export async function isMember() {
  const sb = await supabaseServer();
  if (!sb) return false;
  const { data, error } = await sb.rpc("site_is_member");
  return !error && data === true;
}
