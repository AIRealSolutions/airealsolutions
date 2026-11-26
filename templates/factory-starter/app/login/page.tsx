import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { hasSupabase } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <section className="block">
      <h1>Sign in</h1>
      {!hasSupabase() ? (
        <p>Sign-in is not connected yet.</p>
      ) : (
        <>
          <p>We will email you a sign-in link. Staff only.</p>
          {error && <p className="error">That sign-in link did not work. Ask for a new one.</p>}
          <LoginForm next={safeNext} />
        </>
      )}
    </section>
  );
}
