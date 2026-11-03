import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
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
import { BUSINESS_EMAIL_MESSAGE, isPersonalEmail } from "./businessEmail.js";

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
  /** uid whose profile is settled; the app waits rather than assuming onboarding is unfinished. */
  const [profileUid, setProfileUid] = useState(cached?.uid ?? null);
  const profileUidRef = useRef(profileUid);
  profileUidRef.current = profileUid;
  /** True while a popup sign-in is still being screened, so the app never opens for a rejected account. */
  const [authChecking, setAuthChecking] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setReady(true);
      if (!next) {
        setProfile(null);
        setProfileUid(null);
        rememberProfile(null, null);
        return;
      }
      const saved = readCachedProfile();
      if (saved?.uid === next.uid && saved.profile?.onboardingComplete === true) {
        setProfile(saved.profile);
        setProfileUid(next.uid);
      } else if (profileUidRef.current !== next.uid) {
        setProfileUid(null);
      }
      loadUserProfile(next.uid)
        .then((loaded) => {
          if (auth.currentUser?.uid !== next.uid) return;
          if (loaded) {
            setProfile(loaded);
            rememberProfile(next.uid, loaded);
          }
          setProfileUid(next.uid);
        })
        .catch(() => {
          if (auth.currentUser?.uid === next.uid) setProfileUid(next.uid);
        });
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      ready,
      profileUid,
      authChecking,
      async signUp({ name, email, password, verificationToken }) {
        if (isPersonalEmail(email)) throw Object.assign(new Error(BUSINESS_EMAIL_MESSAGE), { code: "blazly/personal-email", otp: true });
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
        setProfile({ name, email, onboardingComplete: false });
        rememberProfile(cred.user.uid, { name, email, onboardingComplete: false });
        setProfileUid(cred.user.uid);
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
        setAuthChecking(true);
        let cred;
        try {
          cred = await signInWithPopup(auth, googleProvider);
        } catch (error) {
          setAuthChecking(false);
          throw error;
        }
        // Business-email only: drop the account Google just created, or sign out an older personal one.
        if (isPersonalEmail(cred.user.email)) {
          if (getAdditionalUserInfo(cred)?.isNewUser) await cred.user.delete().catch(() => {});
          await signOut(auth).catch(() => {});
          rememberProfile(null, null);
          setProfile(null);
          setProfileUid(null);
          setAuthChecking(false);
          throw Object.assign(new Error(BUSINESS_EMAIL_MESSAGE), { code: "blazly/personal-email" });
        }
        setAuthChecking(false);
        try {
          await saveUserProfile(cred.user);
        } catch {
          // Auth still succeeds if Firestore rules are not published yet.
        }
        setProfile((current) =>
          current
            ? {
                ...current,
                name: cred.user.displayName || current.name || "",
                email: cred.user.email || current.email || "",
              }
            : current
        );
        const previous = readCachedProfile();
        if (previous?.uid === cred.user.uid && previous.profile?.onboardingComplete) {
          rememberProfile(cred.user.uid, {
            ...previous.profile,
            name: cred.user.displayName || previous.profile.name || "",
            email: cred.user.email || previous.profile.email || "",
          });
        }
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
    [user, profile, ready, profileUid, authChecking]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
