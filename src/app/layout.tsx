// src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import ImsShell from "./_components/ImsShell";

export const metadata: Metadata = {
  title: "WATR Internal Management System",
  description: "Inventory, projects and assets for WATR",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ImsShell>{children}</ImsShell>
      </body>
    </html>
  );
}
