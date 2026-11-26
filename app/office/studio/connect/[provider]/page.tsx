import { notFound } from "next/navigation";
import ConnectCallback from "./ConnectCallback";

export const metadata = { title: "Connecting a channel", robots: { index: false } };

export default async function ConnectPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== "youtube" && provider !== "meta") notFound();
  return <ConnectCallback provider={provider} />;
}
