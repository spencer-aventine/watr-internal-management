// src/app/_components/ImsShell.tsx
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "./AuthProvider";

type NavItem = {
  label: string;
  href: string;
  nested?: boolean;
  children?: NavItem[];
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  {
    label: "Inventory",
    href: "/inventory",
    children: [
      { label: "Item list", href: "/inventory" },
      { label: "Sub-assembly pipeline", href: "/inventory/sub-assemblies/pipeline" },
      { label: "Project pipeline", href: "/projects" },
    ],
  },
  {
    label: "Purchasing",
    href: "/purchasing/history",
    children: [
      { label: "Create PO", href: "/purchasing" },
      { label: "Purchase history", href: "/purchasing/history" },
      { label: "Product Tracking", href: "/project-tracking" },
    ],
  },
  {
    label: "Admin",
    href: "/data",
    adminOnly: true,
    children: [
      { label: "Master data", href: "/data/master-data", adminOnly: true },
      { label: "Warehouse data", href: "/data/warehouse-data", adminOnly: true },
      { label: "Suppliers", href: "/suppliers", adminOnly: true },
      { label: "Users", href: "/admin", adminOnly: true },
    ],
  },
  { label: "Reporting (WiP)", href: "/reporting" },
  { label: "Integrations (WiP)", href: "/integrations" },
  { label: "Configurator (WiP)", href: "/configurator" },
];

export default function ImsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navItems.forEach((item) => {
      if (item.children?.length) {
        initial[item.href] = true;
      }
    });
    return initial;
  });

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  const isActive = (href: string, options?: { exact?: boolean }) => {
    if (href === "/") return pathname === "/";
    if (options?.exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const toggle = (href: string) =>
    setExpanded((prev) => ({ ...prev, [href]: !prev[href] }));

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
          {filteredNavItems.map((item) => {
            const hasChildren =
              item.children?.some((child) => !child.adminOnly || isAdmin) ?? false;
            const isExpanded = expanded[item.href] ?? false;
            const active =
              isActive(item.href) ||
              (item.children ?? []).some((child) =>
                isActive(child.href, { exact: true }),
              );
            return (
              <div
                key={item.href}
                style={{ marginBottom: hasChildren ? "0.2rem" : 0 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.35rem",
                  }}
                >
                  <Link
                    href={item.href}
                    className={
                      "ims-sidebar-link" +
                      (active ? " ims-sidebar-link--active" : "")
                    }
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="ims-sidebar-dot" />
                    <span>{item.label}</span>
                  </Link>
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={() => toggle(item.href)}
                      className="ims-secondary-button"
                      style={{
                        padding: "0.15rem 0.35rem",
                        fontSize: "0.78rem",
                        lineHeight: 1,
                        marginLeft: "auto",
                      }}
                      aria-label={`Toggle ${item.label} links`}
                    >
                      {isExpanded ? "▾" : "▸"}
                    </button>
                  )}
                </div>
                {hasChildren && isExpanded && (
                  <div
                    style={{
                      marginLeft: "0.9rem",
                      marginTop: "0.15rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                    }}
                  >
                    {(item.children ?? [])
                      .filter((child) => !child.adminOnly || isAdmin)
                      .map((child) => {
                        const childActive = isActive(child.href, { exact: true });
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={
                              "ims-sidebar-link ims-sidebar-link--nested" +
                              (childActive ? " ims-sidebar-link--active" : "")
                            }
                            aria-current={childActive ? "page" : undefined}
                            style={{
                              fontSize: "0.95rem",
                              paddingTop: "0.25rem",
                              paddingBottom: "0.25rem",
                            }}
                          >
                            <span className="ims-sidebar-dot" />
                            <span>{child.label}</span>
                          </Link>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
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
