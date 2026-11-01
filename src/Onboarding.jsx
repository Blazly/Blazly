import { useAuth } from "./AuthContext.jsx";
import { BrandLogo } from "./BrandLogo.jsx";
import { ProjectSetupWizard } from "./ProjectSetupWizard.jsx";

export function Onboarding() {
  const { completeOnboarding } = useAuth();

  return (
    <main className="onboard">
      <div className="onboard-top">
        <BrandLogo size={30} withText />
      </div>
      <ProjectSetupWizard
        kicker="WELCOME"
        finishLabel="Continue"
        onComplete={async (data) => {
          await completeOnboarding(data);
        }}
      />
    </main>
  );
}
