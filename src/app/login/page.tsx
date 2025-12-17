"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "../_components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  const ensureUserProfile = async (uid: string, emailAddress: string) => {
    const profileRef = doc(db, "users", uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        email: emailAddress,
        accountStatus: "viewOnly",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } else if (!profileSnap.data()?.email) {
      await setDoc(
        profileRef,
        {
          email: emailAddress,
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
      if (isRegister) {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        const createdUser = credential.user;
        if (createdUser) {
          await ensureUserProfile(createdUser.uid, createdUser.email ?? email.trim());
        }
      } else {
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        const signedInUser = credential.user;
        if (signedInUser) {
          await ensureUserProfile(signedInUser.uid, signedInUser.email ?? email.trim());
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
        <h1 className="ims-form-section-title">Sign in</h1>
        <p className="ims-form-section-subtitle">
          Access the WATR internal management system.
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
            <label className="ims-field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="ims-field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {isRegister && (
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
                ? isRegister
                  ? "Creating account…"
                  : "Signing in…"
                : isRegister
                  ? "Create account"
                  : "Sign in"}
            </button>
          </div>
        </form>
        <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
          {isRegister ? "Already have an account?" : "Need an account?"}{" "}
          <button
            type="button"
            className="ims-table-link"
            onClick={() => {
              setIsRegister((prev) => !prev);
              setError(null);
            }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </p>
      </section>
    </main>
  );
}
