import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { installAuthFetch } from "./firebase.js";
import { captureReferralFromUrl } from "./referralClient.js";
import { captureTeamInviteFromUrl } from "./accountClient.js";
import "./styles.css";

installAuthFetch();
captureReferralFromUrl();
captureTeamInviteFromUrl();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
