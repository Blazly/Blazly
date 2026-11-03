import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { BUSINESS_EMAIL_MESSAGE, isPersonalEmail } from "./businessEmail.js";
import { BrandLogo } from "./BrandLogo.jsx";

const COPY = {
  login: {
    eyebrow: "WELCOME BACK",
    title: "Log in to Blazly",
    sub: "Pick up the audits, playbooks, and threads you left open.",
    submit: "Log in",
    switch: "Need an account?",
    action: "Sign up",
  },
  signup: {
    eyebrow: "GET STARTED",
    title: "Create your account",
    sub: "Your Marketing Team, Powered by 15 AI Agents.",
    submit: "Create account",
    switch: "Already have an account?",
    action: "Log in",
  },
  verify: {
    eyebrow: "VERIFY EMAIL",
    title: "Check your email",
    sub: "",
    submit: "Verify & create account",
    switch: "Wrong email?",
    action: "Change it",
  },
  reset: {
    eyebrow: "RESET PASSWORD",
    title: "Forgot your password?",
    sub: "Enter the email on your account. We’ll email you a 6-digit code to reset it.",
    submit: "Send reset code",
    switch: "Remembered it?",
    action: "Back to log in",
  },
  "reset-code": {
    eyebrow: "RESET PASSWORD",
    title: "Choose a new password",
    sub: "",
    submit: "Reset password",
    switch: "Remembered it?",
    action: "Back to log in",
  },
};

export function AuthScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const copy = COPY[mode];

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function requestCode(kind = mode) {
    const result =
      kind === "reset" || kind === "reset-code"
        ? await postJson("/api/auth/otp/reset-send", { email: email.trim() })
        : await postJson("/api/auth/otp/send", { email: email.trim(), name: nameFromEmail(email.trim()) });
    setResendIn(result.resendInSeconds || 60);
  }

  async function resend() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await requestCode();
      setCode("");
      setNotice("We sent a new code.");
    } catch (err) {
      if (err.retryAfter) setResendIn(err.retryAfter);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
    setShowPassword(false);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const trimmedEmail = email.trim();
    const trimmedName = nameFromEmail(trimmedEmail);
    if (!trimmedEmail) {
      setError("Enter your email.");
      return;
    }
    if (mode !== "reset" && password.length < 6) {
      setError(mode === "reset-code" ? "Use at least 6 characters for your new password." : "Use at least 6 characters.");
      return;
    }
    if ((mode === "verify" || mode === "reset-code") && code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if ((mode === "signup" || mode === "verify") && isPersonalEmail(trimmedEmail)) {
      setError(BUSINESS_EMAIL_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await requestCode();
        setCode("");
        setMode("verify");
      } else if (mode === "verify") {
        const { token } = await postJson("/api/auth/otp/verify", { email: trimmedEmail, code });
        await signUp({ name: trimmedName, email: trimmedEmail, password, verificationToken: token });
      } else if (mode === "reset") {
        await requestCode("reset");
        setCode("");
        setPassword("");
        setMode("reset-code");
      } else if (mode === "reset-code") {
        await postJson("/api/auth/otp/reset-confirm", { email: trimmedEmail, code, newPassword: password });
        setCode("");
        setPassword("");
        setMode("login");
        setNotice("Password updated. Log in with your new password.");
      } else {
        await signIn(trimmedEmail, password);
      }
    } catch (err) {
      if (err?.otp) {
        if (err.retryAfter) setResendIn(err.retryAfter);
        setError(err.message);
      } else if (mode === "reset" && err?.code === "auth/user-not-found") {
        setError("No account uses that email.");
      } else {
        setError(authMessage(err?.code));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err?.code === "blazly/personal-email" ? BUSINESS_EMAIL_MESSAGE : authMessage(err?.code, { google: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page is-solo">
      <div className="auth-main">
        <div className="auth-top">
          <BrandLogo className="auth-brand" size={30} withText />
        </div>
        <form className="auth-card" onSubmit={onSubmit}>
          <p className="eyebrow auth-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          {mode === "verify" || mode === "reset-code" ? (
            <p className="auth-sub">
              {mode === "reset-code" ? "If an account exists for " : "We sent a 6-digit code to "}
              <strong>{email.trim()}</strong>
              {mode === "reset-code" ? ", we’ve emailed it a 6-digit code." : "."} It expires in 10 minutes.
            </p>
          ) : (
            <p className="auth-sub">{copy.sub}</p>
          )}

          {(mode === "verify" || mode === "reset-code") && (
            <>
              <OtpInput value={code} onChange={setCode} disabled={busy} />
              <p className="auth-otp-resend">
                Didn’t get it? Check spam, or{" "}
                <button type="button" disabled={busy || resendIn > 0} onClick={resend}>
                  {resendIn > 0 ? `resend in ${resendIn}s` : "resend code"}
                </button>
              </p>
            </>
          )}


          {(mode === "login" || mode === "signup" || mode === "reset") && (
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@company.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          )}

          {(mode === "login" || mode === "signup" || mode === "reset-code") && (
            <div className="auth-field">
              <div className="auth-label-row">
                <label htmlFor="auth-password">{mode === "reset-code" ? "New password" : "Password"}</label>
                {mode === "login" && (
                  <button type="button" className="auth-forgot" onClick={() => switchMode("reset")}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="auth-input">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "login" ? "Your password" : "At least 6 characters"}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-eye"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}
          {notice && <p className="auth-note">{notice}</p>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "Working…" : copy.submit}
          </button>

          {(mode === "login" || mode === "signup") && (
            <>
              <div className="auth-or">or</div>
              <button type="button" className="auth-google" disabled={busy} onClick={onGoogle}>
                <GoogleMark />
                Continue with Google
              </button>
            </>
          )}

          <p className="auth-switch">
            {copy.switch}{" "}
            <button
              type="button"
              onClick={() =>
                switchMode(mode === "signup" ? "login" : mode === "verify" ? "signup" : mode === "login" ? "signup" : "login")
              }
            >
              {copy.action}
            </button>
          </p>
        </form>
        <p className="auth-legal">© {new Date().getFullYear()} Blazly</p>
      </div>
    </div>
  );
}

const ROLE_MAILBOXES = new Set(["info", "hello", "contact", "admin", "support", "sales", "team", "office", "mail", "hi"]);

function nameFromEmail(email) {
  const local = String(email || "").split("@")[0].split("+")[0];
  const words = local
    .replace(/[0-9]+/g, " ")
    .split(/[._\-\s]+/)
    .filter((w) => w.length > 1 || local.length <= 2);
  if (!words.length || ROLE_MAILBOXES.has(words[0].toLowerCase())) return "";
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { otp: true, retryAfter: data.retryAfter });
  }
  return data;
}

function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || "");

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function setAt(index, digit) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, 6));
  }

  function handleChange(index, raw) {
    const clean = raw.replace(/\D/g, "");
    if (clean.length > 1) {
      onChange(clean.slice(0, 6));
      refs.current[Math.min(clean.length, 6) - 1]?.focus();
      return;
    }
    setAt(index, clean);
    if (clean && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index, event) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      setAt(index - 1, "");
      refs.current[index - 1]?.focus();
      event.preventDefault();
    } else if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    else if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  }

  return (
    <div className="auth-otp" role="group" aria-label="Verification code">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={digit}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M1.8 9s2.6-4.2 7.2-4.2S16.2 9 16.2 9s-2.6 4.2-7.2 4.2S1.8 9 1.8 9Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="9" cy="9" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      {off && <path d="M3 3.5 15 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.6-1.9.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
    </svg>
  );
}

function authMessage(code, { google = false } = {}) {
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Log in instead.";
    case "auth/invalid-email":
      return "That email does not look right.";
    case "auth/account-exists-with-different-credential":
      return "That email already uses a password. Log in with email, then you can connect Google.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return google
        ? "Google could not finish sign-in. In Firebase, turn on Google under Authentication → Sign-in method, and keep the Web client ID for this project."
        : "Email or password is wrong.";
    case "auth/weak-password":
      return "Use at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed.";
    case "auth/popup-blocked":
      return "Allow popups, then try Google again.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not turned on in Firebase yet.";
    case "auth/unauthorized-domain":
      return "This domain is not allowed in Firebase Auth.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}
