import type { Metadata, Viewport } from "next";
import OfficeShell from "./OfficeShell";

export const metadata: Metadata = {
  title: { default: "The Office", template: "%s | The Office" },
  description: "Private back office for AI Real Solutions LLC.",
  robots: { index: false, follow: false },
  manifest: "/office.webmanifest",
  appleWebApp: { capable: true, title: "The Office", statusBarStyle: "black-translucent" },
  icons: { apple: "/office-icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0f172a", viewportFit: "cover" };

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return <OfficeShell>{children}</OfficeShell>;
}
