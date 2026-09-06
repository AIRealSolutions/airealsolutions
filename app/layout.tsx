import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://airealsolutions.com"),
  title: {
    default: "AI Real Solutions | Practical AI for Business & Government",
    template: "%s | AI Real Solutions",
  },
  description:
    "AI Real Solutions builds practical AI-assisted tools, automations, websites, and digital workflows for businesses, local governments, campaigns, and community organizations.",
  keywords: [
    "AI consulting",
    "business automation",
    "government technology",
    "municipal AI",
    "workflow automation",
    "application development",
    "public relations",
    "digital marketing",
  ],
  openGraph: {
    title: "AI Real Solutions",
    description:
      "Practical AI-assisted tools and automation for real-world business and government needs.",
    url: "https://airealsolutions.com",
    siteName: "AI Real Solutions",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
