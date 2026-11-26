// Every page in site.json, drawn section by section.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Section from "@/components/Sections";
import { findPage, site } from "@/lib/site";

type Props = { params: Promise<{ path?: string[] }> };
const routeOf = (path?: string[]) => "/" + (path ?? []).join("/");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage(routeOf((await params).path));
  if (!page) return {};
  return page.route === "/" ? { title: { absolute: `${site.brand.name} | ${site.brand.tagline || page.title}` } } : { title: page.title };
}

export default async function SitePage({ params }: Props) {
  const page = findPage(routeOf((await params).path));
  if (!page) notFound();
  return page.sections.map((s, i) => <Section key={i} s={s} />);
}
