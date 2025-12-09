// src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "./_components/AuthProvider";
import AppShell from "./_components/AppShell";

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
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
