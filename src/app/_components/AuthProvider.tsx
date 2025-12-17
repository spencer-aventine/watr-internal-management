"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type AccountStatus = "admin" | "coreUser" | "viewOnly";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  accountStatus: AccountStatus;
  isAdmin: boolean;
  canEdit: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  accountStatus: "viewOnly",
  isAdmin: false,
  canEdit: false,
});

const normalizeStatus = (value?: string | null): AccountStatus => {
  switch (value) {
    case "admin":
    case "viewOnly":
    case "coreUser":
      return value;
    case "core user":
    case "core-user":
      return "coreUser";
    default:
      return "viewOnly";
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("viewOnly");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setAccountStatus("viewOnly");
      return;
    }
    let cancelled = false;
    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          setAccountStatus(
            normalizeStatus((snap.data() as any)?.accountStatus),
          );
        } else {
          setAccountStatus("viewOnly");
        }
      } catch (err) {
        console.error("Error loading user profile", err);
        if (!cancelled) setAccountStatus("viewOnly");
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const combinedLoading = authLoading || profileLoading;
  const isAdmin = accountStatus === "admin";
  const canEdit = accountStatus !== "viewOnly";

  return (
    <AuthContext.Provider
      value={{ user, loading: combinedLoading, accountStatus, isAdmin, canEdit }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
