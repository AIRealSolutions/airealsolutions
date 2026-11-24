import ContactPage from "./ContactPage";

export const metadata = { title: "Contact" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactPage id={id} />;
}
