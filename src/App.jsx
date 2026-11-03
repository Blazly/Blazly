import { useState } from "react";
import { Workspace } from "./Workspace.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { Onboarding } from "./Onboarding.jsx";
import { useAuth } from "./AuthContext.jsx";
import { SharedChatView } from "./SharedChatView.jsx";
import { shareIdFromLocation } from "./chatShare.js";
import { Ga4AuthTracker, Ga4ShareTracker, Ga4UserTracker } from "./Ga4Tracker.jsx";

export default function App() {
  const [shareId] = useState(() => shareIdFromLocation());
  if (shareId) {
    return (
      <>
        <Ga4ShareTracker shareId={shareId} />
        <SharedChatView shareId={shareId} />
      </>
    );
  }
  return (
    <>
      <Ga4UserTracker />
      <AuthedApp />
    </>
  );
}

function AuthedApp() {
  const { user, profile, ready, profileUid, authChecking } = useAuth();

  if (!ready) return <div className="auth-gate" />;
  if (!user || authChecking) {
    return (
      <>
        <Ga4AuthTracker screen="auth" />
        <AuthScreen />
      </>
    );
  }
  if (profileUid !== user.uid) return <div className="auth-gate" />;
  if (!profile?.onboardingComplete) {
    return (
      <>
        <Ga4AuthTracker screen="onboarding" />
        <Onboarding />
      </>
    );
  }

  return <Workspace />;
}
