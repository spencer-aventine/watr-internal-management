"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  isSignInWithEmailLink,
  signInWithEmailLink,
  updatePassword,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  type DocumentReference,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "../_components/AuthProvider";

type AccountStatus = "admin" | "coreUser" | "viewOnly";

type PendingInvite = {
  ref: DocumentReference;
  status: AccountStatus;
};

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEmailLinkMode, setIsEmailLinkMode] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isSignInWithEmailLink(auth, window.location.href)) {
      setIsEmailLinkMode(true);
      const storedEmail = window.localStorage.getItem("watr_invite_email") ?? "";
      if (storedEmail) {
        setEmail(storedEmail);
      }
    }
  }, []);

  const normalizeStatus = (value?: string | null): AccountStatus => {
    switch (value) {
      case "admin":
      case "coreUser":
      case "viewOnly":
        return value;
      case "core user":
      case "core-user":
        return "coreUser";
      default:
        return "viewOnly";
    }
  };

  const fetchPendingInvite = async (
    emailAddress: string,
  ): Promise<PendingInvite | null> => {
    const emailLower = emailAddress.trim().toLowerCase();
    const snap = await getDocs(
      query(
        collection(db, "pendingInvites"),
        where("emailLower", "==", emailLower),
      ),
    );
    const inviteDoc = snap.docs[0];
    if (!inviteDoc) return null;
    const data = inviteDoc.data() as any;
    const status = normalizeStatus(data.accountStatus);
    return { ref: inviteDoc.ref, status };
  };

  const ensureUserProfile = async (
    uid: string,
    emailAddress: string,
    accountStatusOverride?: AccountStatus | null,
  ) => {
    const profileRef = doc(db, "users", uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        email: emailAddress,
        accountStatus: accountStatusOverride ?? "viewOnly",
        invitedAt: Timestamp.now(),
        acceptedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } else if (!profileSnap.data()?.email) {
      await setDoc(
        profileRef,
        {
          email: emailAddress,
          ...(accountStatusOverride ? { accountStatus: accountStatusOverride } : {}),
          acceptedAt: profileSnap.data()?.acceptedAt ?? Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } else if (accountStatusOverride) {
      await setDoc(
        profileRef,
        {
          accountStatus: accountStatusOverride,
          acceptedAt: profileSnap.data()?.acceptedAt ?? Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isEmailLinkMode) {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
          setError("Enter your email to complete sign-in.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword || !password.trim()) {
          setError("Enter and confirm your new password.");
          setLoading(false);
          return;
        }
        const invite = await fetchPendingInvite(trimmedEmail);
        if (!invite) {
          setError("This email is not invited. Ask an admin to invite you.");
          setLoading(false);
          return;
        }
        const credential = await signInWithEmailLink(
          auth,
          trimmedEmail,
          window.location.href,
        );
        const signedInUser = credential.user;
        if (signedInUser) {
          await ensureUserProfile(
            signedInUser.uid,
            signedInUser.email ?? trimmedEmail,
            invite.status,
          );
          await updatePassword(signedInUser, password);
        }
        try {
          await deleteDoc(invite.ref);
        } catch {
          // non-fatal
        }
        window.localStorage.removeItem("watr_invite_email");
      } else {
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        const signedInUser = credential.user;
        if (signedInUser) {
          await ensureUserProfile(
            signedInUser.uid,
            signedInUser.email ?? email.trim(),
          );
        }
      }
      router.replace("/");
    } catch (err: any) {
      console.error("Auth error", err);
      setError(err?.message ?? "Unable to authenticate.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="ims-content" style={{ maxWidth: "420px", margin: "4rem auto" }}>
      <section className="card ims-form-section">
        <h1 className="ims-form-section-title">
          {isEmailLinkMode ? "Complete account setup" : "Sign in"}
        </h1>
        <p className="ims-form-section-subtitle">
          {isEmailLinkMode
            ? "Enter your email and set a password to finish your invite."
            : "Access the WATR internal management system."}
        </p>
        <form onSubmit={handleSubmit} className="ims-form" style={{ marginTop: "1rem" }}>
          <div className="ims-field">
            <label className="ims-field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="ims-field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="ims-field">
            <label
              className="ims-field-label"
              htmlFor={isEmailLinkMode ? "newPassword" : "password"}
            >
              {isEmailLinkMode ? "Create password" : "Password"}
            </label>
            <input
              id={isEmailLinkMode ? "newPassword" : "password"}
              type="password"
              className="ims-field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isEmailLinkMode ? "new-password" : "current-password"}
            />
          </div>

          {isEmailLinkMode && (
            <div className="ims-field">
              <label className="ims-field-label" htmlFor="confirmPassword">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                className="ims-field-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <div className="ims-alert ims-alert--error">{error}</div>}

          <div className="ims-form-actions">
            <button
              type="submit"
              className="ims-primary-button"
              disabled={loading}
            >
              {loading
                ? isEmailLinkMode
                  ? "Completing…"
                  : "Signing in…"
                : isEmailLinkMode
                  ? "Complete setup"
                  : "Sign in"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
