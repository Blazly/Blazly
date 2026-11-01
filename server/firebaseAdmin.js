import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

export function firebaseAdminConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

export function adminAuth() {
  if (!firebaseAdminConfigured()) {
    throw Object.assign(new Error("Password reset is not configured on the server yet."), { status: 500 });
  }
  if (!getApps().length) {
    const account = serviceAccount();
    initializeApp({
      credential: account ? cert(account) : applicationDefault(),
      projectId: account?.project_id || process.env.VITE_FIREBASE_PROJECT_ID,
    });
  }
  return getAuth();
}
