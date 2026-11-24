import type { Metadata } from "next";
import OfficeShell from "./OfficeShell";

export const metadata: Metadata = {
  title: { default: "The Office", template: "%s | The Office" },
  description: "Private back office for AI Real Solutions LLC.",
  robots: { index: false, follow: false },
};

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return <OfficeShell>{children}</OfficeShell>;
}
