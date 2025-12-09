// src/app/_components/ImsShell.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "./AuthProvider";

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Inventory", href: "/inventory" },
  { label: "Purchasing", href: "/purchasing/history" },
  { label: "Projects", href: "/projects" },
  { label: "Product Tracking", href: "/project-tracking" },
  { label: "Reporting", href: "/reporting" },
  { label: "Integrations", href: "/integrations" },
  { label: "Configurator (WiP)", href: "/configurator" },
  { label: "Admin", href: "/admin" },
];

export default function ImsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="ims-shell">
      {/* Sidebar */}
      <aside className="ims-sidebar">
        <div className="ims-sidebar-header">
          <div className="ims-logo-mark">
            <Image
              src="/logo.png" // ✅ in /public/logo.png
              alt="WATR logo"
              width={32}
              height={32}
              className="ims-logo-img"
            />
          </div>
          <div className="ims-logo-text">
            <span className="ims-logo-title">WATR IMS</span>
            <span className="ims-logo-subtitle">Inventory & Projects</span>
          </div>
        </div>

        <nav className="ims-sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                "ims-sidebar-link" +
                (isActive(item.href) ? " ims-sidebar-link--active" : "")
              }
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              <span className="ims-sidebar-dot" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="ims-main">
        <header className="ims-header">
          <div />
          <div className="ims-header-actions">
            {user && (
              <>
                <span style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                  {user.email}
                </span>
                <button
                  type="button"
                  className="ims-secondary-button"
                  onClick={() => signOut(auth)}
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
