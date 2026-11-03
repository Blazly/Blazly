import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { installAuthFetch } from "./firebase.js";
import { captureReferralFromUrl } from "./referralClient.js";
import { captureTeamInviteFromUrl } from "./accountClient.js";
import { captureProjectJoinFromUrl } from "./sharedProjectsClient.js";
import { initGa4 } from "./analytics.js";
import { initClarity } from "./clarity.js";
import "./styles.css";

initGa4();
initClarity();
installAuthFetch();
captureReferralFromUrl();
captureTeamInviteFromUrl();
captureProjectJoinFromUrl();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
