import VenturePage from "./VenturePage";

export const metadata = { title: "Incubator" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <VenturePage slug={slug} />;
}
