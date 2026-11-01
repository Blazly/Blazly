import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  auth,
  googleProvider,
  loadUserProfile,
  saveOnboarding,
  saveUserProfile,
  updateUserProfileFields,
} from "./firebase.js";

const AuthContext = createContext(null);

const PROFILE_KEY = "blazly-profile";

function readCachedProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (saved?.uid && saved.profile) return saved;
  } catch {
    // Ignore a profile cache this browser cannot read.
  }
  return null;
}

function rememberProfile(uid, profile) {
  try {
    if (!uid || !profile) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, JSON.stringify({ uid, profile }));
  } catch {
    // The session still works if storage is full or blocked.
  }
}

export function AuthProvider({ children }) {
  const cached = readCachedProfile();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(cached?.profile ?? null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      if (!next) {
        setProfile(null);
        rememberProfile(null, null);
        setReady(true);
        return;
      }
      const saved = readCachedProfile();
      if (saved?.uid === next.uid) {
        setProfile(saved.profile);
        setReady(true);
      }
      const request = loadUserProfile(next.uid);
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
      Promise.race([request, timeout])
        .catch(() => null)
        .finally(() => setReady(true));
      request
        .then((loaded) => {
          if (!loaded) return;
          setProfile(loaded);
          rememberProfile(next.uid, loaded);
        })
        .catch(() => {});
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      ready,
      async signUp({ name, email, password, verificationToken }) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        try {
          await saveUserProfile(cred.user, { name });
          if (verificationToken) {
            await updateUserProfileFields(cred.user.uid, { emailVerifiedAt: new Date().toISOString(), emailVerifiedVia: "otp" });
          }
        } catch {
          // Auth still succeeds if Firestore rules are not published yet.
        }
        setProfile((current) => ({ ...current, name, email }));
        rememberProfile(cred.user.uid, { name, email, onboardingComplete: false });
        setUser(auth.currentUser);
        return cred.user;
      },
      signIn(email, password) {
        return signInWithEmailAndPassword(auth, email, password);
      },
      resetPassword(email) {
        return sendPasswordResetEmail(auth, email);
      },
      async signInWithGoogle() {
        const cred = await signInWithPopup(auth, googleProvider);
        try {
          await saveUserProfile(cred.user);
        } catch {
          // Auth still succeeds if Firestore rules are not published yet.
        }
        setProfile((current) => ({
          ...current,
          name: cred.user.displayName || "",
          email: cred.user.email || "",
        }));
        const previous = readCachedProfile();
        const base = previous?.uid === cred.user.uid ? previous.profile : {};
        rememberProfile(cred.user.uid, {
          ...base,
          name: cred.user.displayName || base.name || "",
          email: cred.user.email || base.email || "",
        });
        return cred.user;
      },
      async completeOnboarding(data) {
        if (user) {
          try {
            await saveOnboarding(user.uid, data);
          } catch {
            // The workspace still opens if Firestore rules are not published yet.
          }
        }
        setProfile((current) => {
          const nextProfile = {
            ...current,
            project: data.projectName,
            website: data.website,
            knowledge: data.knowledge,
            onboardingComplete: true,
          };
          if (user) rememberProfile(user.uid, nextProfile);
          return nextProfile;
        });
      },
      async updateProfileFields(fields) {
        if (!user) throw new Error("Sign in to update your profile.");
        await updateUserProfileFields(user.uid, fields);
        setProfile((current) => {
          const nextProfile = { ...current, ...fields };
          rememberProfile(user.uid, nextProfile);
          return nextProfile;
        });
      },
      signOutUser() {
        rememberProfile(null, null);
        return signOut(auth);
      },
    }),
    [user, profile, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
