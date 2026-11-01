import { useState } from "react";
import { Workspace } from "./Workspace.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { Onboarding } from "./Onboarding.jsx";
import { useAuth } from "./AuthContext.jsx";
import { SharedChatView } from "./SharedChatView.jsx";
import { shareIdFromLocation } from "./chatShare.js";

export default function App() {
  const [shareId] = useState(() => shareIdFromLocation());
  if (shareId) return <SharedChatView shareId={shareId} />;
  return <AuthedApp />;
}

function AuthedApp() {
  const { user, profile, ready } = useAuth();

  if (!ready && !profile) return <div className="auth-gate" />;
  if (ready && !user) return <AuthScreen />;
  if (!profile?.onboardingComplete) return <Onboarding />;

  return <Workspace />;
}
