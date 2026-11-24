import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../office.module.css";
import { findModule, upcomingModules } from "../lib/modules";

// Sections that are planned but not built yet. Built sections have their own folder,
// which Next.js matches before this dynamic segment.
export const dynamicParams = false;

export function generateStaticParams() {
  return upcomingModules().map((m) => ({ module: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const { module } = await params;
  return { title: findModule(module)?.label ?? "Office" };
}

export default async function UpcomingModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const m = findModule(module);
  if (!m || m.ready) notFound();
  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Coming in phase {m.phase}</span>
        <h1>{m.label}</h1>
        <p>{m.summary}</p>
      </header>
      <div className={styles.card}>
        <h2>What this section will do</h2>
        <ul className={styles.list}>
          {m.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className={styles.muted}>The full plan is in <code>docs/back-office-plan.md</code>.</p>
      </div>
    </section>
  );
}
