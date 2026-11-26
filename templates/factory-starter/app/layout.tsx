import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { site } from "@/lib/site";
import { currentUser } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/supabase/env";
import NavLinks from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: site.brand.name, template: `%s | ${site.brand.name}` },
  description: site.brand.tagline,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  const theme = { "--p": site.brand.primary_color, "--a": site.brand.accent_color } as CSSProperties;
  return (
    <html lang="en">
      <body className="site" style={theme}>
        <header className="header">
          <Link href="/" className="logo">
            <span style={{ background: site.brand.primary_color }}>{site.brand.name.slice(0, 1)}</span>
            {site.brand.name}
          </Link>
          <NavLinks pages={site.pages} />
          {hasSupabase() && (
            <div className="account">
              {user ? (
                <form action="/auth/signout" method="post">
                  <button className="linkButton" type="submit">Sign out</button>
                </form>
              ) : (
                <Link href="/login">Sign in</Link>
              )}
            </div>
          )}
        </header>
        <main className="main">{children}</main>
        <footer className="footer">
          <span>
            © {new Date().getFullYear()} {site.brand.name}
          </span>
          <span>{site.brand.tagline}</span>
        </footer>
      </body>
    </html>
  );
}
