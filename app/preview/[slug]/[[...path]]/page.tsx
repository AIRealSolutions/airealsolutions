import type { Metadata } from "next";
import PreviewSite from "../PreviewSite";

// Instant preview of a project's Site Spec. Drawn in the browser, because project members are
// recognised by the Factory session kept in browser storage; visitors see it only while sharing is on.
export const metadata: Metadata = {
  title: { absolute: "Prototype preview" },
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<{ v?: string | string[]; invite?: string | string[] }>;
}) {
  const { slug, path } = await params;
  const { v, invite } = await searchParams;
  const token = (Array.isArray(invite) ? invite[0] : invite)?.trim().slice(0, 64) || null;
  const version = Number(Array.isArray(v) ? v[0] : v);
  const route = "/" + (path ?? []).map((p) => p.toLowerCase()).join("/");
  return <PreviewSite slug={slug} route={route === "/" ? "/" : route.replace(/\/+$/, "")} version={Number.isInteger(version) && version > 0 ? version : null} invite={token} />;
}
