import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindArchive Production Hub",
  description: "Automated faceless YouTube video production",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Sidebar />
        <main className="ml-64 min-h-screen">
          <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
