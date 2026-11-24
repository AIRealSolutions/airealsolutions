import DealPage from "./DealPage";

export const metadata = { title: "Deal" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealPage id={id} />;
}
