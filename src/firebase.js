import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();

/** Sends the signed-in user's ID token with every same-origin /api request so the server can charge credits. */
export function installAuthFetch() {
  if (typeof window === "undefined" || window.__blazlyAuthFetch) return;
  window.__blazlyAuthFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    const sameOriginApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
    if (!sameOriginApi || !auth.currentUser) return original(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) {
      try {
        headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
      } catch {
        // Fall through without a token; the server will ask the user to sign in.
      }
    }
    const job = window.__blazlyJobContext;
    if (job && (init.method || "GET").toUpperCase() === "POST") {
      if (job.chatId) headers.set("X-Blazly-Chat", String(job.chatId));
      if (job.agentId) headers.set("X-Blazly-Agent", String(job.agentId));
      if (job.project) headers.set("X-Blazly-Project", String(job.project));
    }
    const response = await original(input, { ...init, headers });
    if (response.status === 402 || (response.ok && CREDIT_PATHS.some((p) => url.includes(p)))) {
      window.dispatchEvent(new CustomEvent("blazly:credits-changed"));
    }
    if (response.status === 402) window.dispatchEvent(new CustomEvent("blazly:out-of-credits"));
    return response;
  };
}

const CREDIT_PATHS = [
  "/api/chat",
  "/api/ai-orchestrator",
  "/api/keyword-finder",
  "/api/serp-tracking",
  "/api/integrations/agent",
  "/api/humanize",
  "/api/prompt-research",
  "/api/ranking-opportunities",
  "/api/backlink-finder",
  "/api/local-seo",
  "/api/ai-visibility",
  "/api/brand-sentiment",
  "/api/competitor-research",
  "/api/b2b-lead-finder",
  "/api/blog-writer",
  "/api/site-audit",
];

export async function fetchCredits() {
  const response = await fetch("/api/credits");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load credits.");
  return data;
}
googleProvider.setCustomParameters({ prompt: "select_account" });

if (typeof window !== "undefined") {
  const startAnalytics = () => {
    isSupported()
      .then((ok) => {
        if (ok) getAnalytics(app);
      })
      .catch(() => {});
  };
  window.setTimeout(startAnalytics, 4000);
}

export async function saveUserProfile(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      name: extra.name || user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
      ...extra,
    },
    { merge: true }
  );
}

export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;

export async function uploadProfilePhoto(uid, file) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error("Use a PNG, JPG, WebP or GIF image.");
  if (file.size > MAX_PROFILE_PHOTO_BYTES) throw new Error("Use an image under 5 MB.");
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const ref = storageRef(storage, `users/${uid}/profile/avatar-${Date.now()}.${ext}`);
  await uploadBytes(ref, file, { contentType: file.type, cacheControl: "public, max-age=31536000" });
  return { avatarURL: await getDownloadURL(ref), avatarPath: ref.fullPath };
}

export async function deleteProfilePhoto(path) {
  if (!path) return;
  await deleteObject(storageRef(storage, path)).catch(() => {});
}

export async function updateUserProfileFields(uid, fields) {
  await setDoc(doc(db, "users", uid), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveProject(uid, project) {
  await setDoc(
    doc(db, "users", uid),
    { project, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function saveOnboarding(uid, data) {
  await setDoc(
    doc(db, "users", uid),
    {
      project: data.projectName,
      website: data.website,
      knowledge: data.knowledge,
      onboardingComplete: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
