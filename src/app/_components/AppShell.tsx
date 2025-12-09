"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import ImsShell from "./ImsShell";
import { useAuth } from "./AuthProvider";

const publicRoutes = new Set(["/login"]);

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const isPublicRoute = publicRoutes.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicRoute) {
      router.replace("/login");
    } else if (user && isPublicRoute) {
      router.replace("/");
    }
  }, [user, loading, isPublicRoute, router]);

  if (loading) {
    return (
      <div className="ims-loading" style={{ padding: "2rem", textAlign: "center" }}>
        Checking authentication…
      </div>
    );
  }

  if (!user && !isPublicRoute) {
    return (
      <div className="ims-loading" style={{ padding: "2rem", textAlign: "center" }}>
        Redirecting to login…
      </div>
    );
  }

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return <ImsShell>{children}</ImsShell>;
}
