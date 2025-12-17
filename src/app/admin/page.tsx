"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "../_components/AuthProvider";

type AccountStatus = "admin" | "coreUser" | "viewOnly";

type UserRecord = {
  id: string;
  email: string;
  accountStatus: AccountStatus;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

const statusOptions: { value: AccountStatus; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "coreUser", label: "Core User" },
  { value: "viewOnly", label: "View Only" },
];

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

const formatDate = (value?: Timestamp | null) => {
  if (!value) return "—";
  try {
    return value.toDate().toLocaleString();
  } catch {
    return "—";
  }
};

export default function AdminPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const rows: UserRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          email: data.email ?? "unknown@watr.eco",
          accountStatus: normalizeStatus(data.accountStatus),
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        };
      });
      setUsers(rows);
    } catch (err: any) {
      console.error("Error loading users", err);
      setError(err?.message ?? "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setLoading(false);
      return;
    }
    loadUsers();
  }, [isAdmin]);

  const handleStatusChange = async (userId: string, nextStatus: AccountStatus) => {
    setUpdatingId(userId);
    setError(null);
    setMessage(null);
    try {
      await updateDoc(doc(db, "users", userId), {
        accountStatus: nextStatus,
        updatedAt: Timestamp.now(),
      });
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, accountStatus: nextStatus } : user,
        ),
      );
      setMessage("Account status updated.");
    } catch (err: any) {
      console.error("Error updating account status", err);
      setError(err?.message ?? "Unable to update this user.");
    } finally {
      setUpdatingId(null);
    }
  };

  if (!authLoading && !isAdmin) {
    return (
      <main className="ims-content">
        <section className="ims-form-section card">
          <h1 className="ims-form-section-title">Admin</h1>
          <p className="ims-form-section-subtitle">
            You need admin privileges to manage user accounts. Please contact an
            administrator if you believe this is an error.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="ims-content">
      <div className="ims-page-header ims-page-header--with-actions">
        <div>
          <h1 className="ims-page-title">Admin</h1>
          <p className="ims-page-subtitle">
            Review everyone with IMS access and adjust their account status.
          </p>
        </div>
        <div className="ims-page-actions">
          <button
            type="button"
            className="ims-secondary-button"
            onClick={loadUsers}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {(error || message) && (
        <div
          className={
            "ims-alert " + (error ? "ims-alert--error" : "ims-alert--info")
          }
        >
          {error || message}
        </div>
      )}

      <section className="ims-form-section card">
        <div className="ims-table-header">
          <div>
            <h2 className="ims-form-section-title">User accounts</h2>
            <p className="ims-form-section-subtitle">
              New registrations default to View Only until upgraded here.
            </p>
          </div>
          <span className="ims-table-count">
            {users.length ? `${users.length} accounts` : "No users yet"}
          </span>
        </div>

        {loading ? (
          <p className="ims-table-empty">Loading accounts…</p>
        ) : users.length === 0 ? (
          <p className="ims-table-empty">
            No registered users just yet. Once a teammate signs up they will appear
            here.
          </p>
        ) : (
          <div className="ims-table-wrapper">
            <table className="ims-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: "160px" }}>Account status</th>
                  <th>Created</th>
                  <th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>
                      <select
                        className="ims-field-input"
                        value={user.accountStatus}
                        disabled={updatingId === user.id}
                        onChange={(e) =>
                          handleStatusChange(
                            user.id,
                            e.target.value as AccountStatus,
                          )
                        }
                      >
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{user.updatedAt ? formatDate(user.updatedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
