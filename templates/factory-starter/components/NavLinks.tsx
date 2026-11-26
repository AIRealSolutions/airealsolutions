"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLinks({ pages }: { pages: { route: string; nav_label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {pages.map((p) => (
        <Link key={p.route} href={p.route} className={p.route === path ? "current" : ""} aria-current={p.route === path ? "page" : undefined}>
          {p.nav_label}
        </Link>
      ))}
    </nav>
  );
}
