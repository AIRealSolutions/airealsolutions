import { redirect } from "next/navigation";

// Factory administration now lives in the Office.
export default function AdminPage() {
  redirect("/office/factory-accounts");
}
