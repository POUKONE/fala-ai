"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { csrfFetch } from "../csrf-client";
type Mode = "login" | "register" | "forgot" | "reset";
const TAB_SESSION_KEY = "fala_tab_session";

declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string; reset?: (widgetId?: string) => void };
  }
}

function AuthPageContent() {
  const params = useSearchParams();
  const requiresFreshAuth = params.get("reauth") === "1";
  const requestedPath = params.get("next") ?? "/";
  const nextPath = requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/";
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : params.get("mode") === "reset" ? "reset" : "login");
  // Read the token from the current URL on every render. Keeping it in state
  // can leave it empty after the browser hydrates a password-reset link.
  const resetToken = params.get("token") ?? "";
  const [supabaseRecoveryToken, setSupabaseRecoveryToken] = useState("");
  const resetExpiryFromUrl = Number(params.get("expires") ?? 0);
  const [resetDeadline, setResetDeadline] = useState(resetExpiryFromUrl || 0);
  const [recoveryDeadline, setRecoveryDeadline] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { const hash = new URLSearchParams(window.location.hash.replace(/^#/, "")); const token = hash.get("access_token") ?? ""; if (token && hash.get("type") === "recovery") { setSupabaseRecoveryToken(token); setResetDeadline(Date.now() + 3600000); setMode("reset"); window.history.replaceState({}, "", `${window.location.pathname}?mode=reset`); } }, []);
  useEffect(() => { if (!recoveryDeadline && !resendAvailableAt && !resetDeadline) return; const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, [recoveryDeadline, resendAvailableAt, resetDeadline]);
  useEffect(() => { if (mode === "reset" && !resetDeadline) setResetDeadline(Date.now() + 3600000); }, [mode, resetDeadline]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signupStep, setSignupStep] = useState<"email" | "code" | "password">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const captchaContainer = useRef<HTMLDivElement>(null);
  const captchaWidget = useRef<string | null>(null);
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const resetExpired = mode === "reset" && resetDeadline > 0 && resetDeadline <= clock;
  const recoverySeconds = recoveryDeadline > clock ? Math.ceil((recoveryDeadline - clock) / 1000) : 0;
  const resendSeconds = resendAvailableAt > clock ? Math.ceil((resendAvailableAt - clock) / 1000) : 0;
  const formatRemaining = (seconds: number) => `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;

  useEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const isBackForward = navigation?.type === "back_forward";
    const signOutAfterBack = () => {
      window.sessionStorage.removeItem(TAB_SESSION_KEY);
      setEmail(""); setPassword(""); setName(""); setShowPassword(false); setCaptchaToken("");
      // Going back from a workspace to the auth page is an explicit logout.
      // A normal direct visit (including a copied link in a new tab) does not
      // invalidate the account session.
      void csrfFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    };
    if (isBackForward) signOutAfterBack();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) signOutAfterBack(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (!captchaRequired || mode !== "login" || !captchaSiteKey || !captchaContainer.current) return;
    const render = () => {
      if (!window.turnstile || !captchaContainer.current || captchaWidget.current) return;
      captchaWidget.current = window.turnstile.render(captchaContainer.current, {
        sitekey: captchaSiteKey,
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": () => setCaptchaToken(""),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-fala-turnstile="true"]');
    if (existing) { render(); return; }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.falaTurnstile = "true";
    script.onload = render;
    document.head.appendChild(script);
  }, [captchaRequired, captchaSiteKey, mode]);

  function switchMode(next: Mode) {
    setMode(next); setMessage(""); setError(""); if (next === "register") setSignupStep("email");
  }

  function redirectAfterLogin(path: string) {
    const destination = new URL(path, window.location.origin).toString();
    // Use a full navigation so the freshly issued HttpOnly cookie is read by
    // the workspace. The short fallback handles browsers that keep the auth
    // route mounted after replace() while the server response is completing.
    window.location.assign(destination);
    window.setTimeout(() => {
      if (window.location.pathname === "/auth") window.location.href = destination;
    }, 700);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetExpired) { setError("Ce lien de récupération a expiré. Demandez un nouveau lien."); return; }
    setBusy(true); setError(""); setMessage("");
    const endpoint = mode === "register" ? (signupStep === "email" ? "/api/auth/send-code" : signupStep === "code" ? "/api/auth/verify-code" : "/api/auth/register") : mode === "forgot" ? "/api/auth/forgot" : mode === "reset" ? "/api/auth/reset-password" : "/api/auth/login";
    const body = mode === "register" ? (signupStep === "email" ? { email, displayName: name, consent } : signupStep === "code" ? { email, code: password } : { email, password, displayName: name, consent }) : mode === "reset" ? { token: resetToken, accessToken: supabaseRecoveryToken, password } : { email, password, captchaToken };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await csrfFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCaptchaRequired(Boolean(data.captchaRequired));
        if (response.status === 401) throw new Error(String(data.error ?? "").toLowerCase().includes("session") ? "Session expirée. Veuillez vous reconnecter." : "Identifiants incorrects");
        if (response.status === 403 && /suspend/i.test(String(data.error ?? ""))) throw new Error("Compte suspendu");
        throw new Error(data.error || "Impossible de traiter la demande.");
      }
      if (mode === "forgot") { const ttl = Number(data.expiresInSeconds ?? 3600); setRecoveryDeadline(Date.now() + ttl * 1000); setResendAvailableAt(Date.now() + 60000); setMessage(data.message || "Si cette adresse existe, un lien de récupération a été envoyé."); }
      else if (mode === "reset") { setMode("login"); setMessage("Mot de passe modifié. Vous pouvez vous connecter."); }
      else if (mode === "register" && signupStep === "email") { setSignupStep("code"); setPassword(""); setMessage(data.message || "Un code de vérification vient d’être envoyé."); }
      else if (mode === "register" && signupStep === "code") { setSignupStep("password"); setPassword(""); setMessage(data.message || "Adresse vérifiée. Choisissez maintenant votre mot de passe."); }
      else if (mode === "register" && data.requiresEmailConfirmation) { setMode("login"); setMessage(data.message || "Votre compte est créé. Confirmez votre adresse e-mail avant de vous connecter."); }
      else if (mode === "register") { window.sessionStorage.setItem(TAB_SESSION_KEY, "1"); setMode("login"); setSignupStep("email"); setPassword(""); setMessage(data.message || "Votre compte est créé avec succès. Vous pouvez maintenant vous connecter."); }
      else {
        window.sessionStorage.setItem(TAB_SESSION_KEY, "1");
        setCaptchaRequired(false); setCaptchaToken("");
        // A full navigation guarantees that the freshly issued HttpOnly
        // session cookie is read by the workspace before rendering it.
        redirectAfterLogin(nextPath);
      }
    } catch (cause) {
      setError(cause instanceof DOMException && cause.name === "AbortError"
        ? "La connexion prend trop de temps. Vérifiez votre réseau puis réessayez."
        : cause instanceof Error ? cause.message : "Une erreur est survenue.");
    } finally { window.clearTimeout(timeout); setBusy(false); }
  }

  const title = mode === "register" ? "Créer votre espace" : mode === "forgot" ? "Récupérer l’accès" : mode === "reset" ? "Nouveau mot de passe" : "Ravi de vous revoir";
  return <main className="auth-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <header className="auth-nav"><Link href="/" className="brand"><span className="brand-mark">F</span><span>Fala <b>AI</b></span></Link><Link href="/" className="auth-back">Retour à l’accueil</Link></header>
    <section className="auth-layout">
      <div className="auth-pitch"><span className="public-kicker">VOTRE RECHERCHE, SOUS CONTRÔLE</span><h1>Un espace privé,<br/><em>vraiment à vous.</em></h1><p>Retrouvez vos candidatures et votre historique à chaque connexion. Vos données restent isolées et exportables.</p><div className="auth-points"><span>✓ Compte e-mail autonome</span><span>✓ Connexion sécurisée</span><span>✓ Historique conservé</span></div></div>
      <div className="auth-card">
        <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Connexion</button><button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Inscription</button></div>
        <h2>{title}</h2><p className="auth-subtitle">{requiresFreshAuth && mode === "login" ? "Pour votre sécurité, reconnectez-vous dans ce nouvel onglet." : mode === "forgot" ? "Saisissez votre adresse et nous vous aiderons à retrouver votre compte." : "Utilisez votre adresse e-mail et un mot de passe."}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-success" role="status">{message}</div>}
        <form ref={formRef} onSubmit={submit} autoComplete={mode === "login" ? "on" : "off"}>
          {mode === "register" && <label>Nom complet affiché<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ex. Ibrahim POUKONE" minLength={2} maxLength={120} required /><small>Ce nom sera visible dans votre espace Fala AI.</small></label>}
          {mode !== "reset" && <label>Adresse e-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete={mode === "login" ? "username" : "email"} required /></label>}
          {mode === "register" && signupStep === "code" && <label>Code reçu par e-mail<input inputMode="numeric" pattern="[0-9]{6}" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} maxLength={6} autoComplete="one-time-code" required /><small>Le code est valable 10 minutes</small></label>}
          {mode !== "forgot" && (mode !== "register" || signupStep === "password") && <label>Mot de passe<span className="auth-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} aria-pressed={showPassword}>{showPassword ? "Masquer" : "Afficher"}</button></span><small>8 caractères minimum</small></label>}
          {mode === "login" && captchaRequired && <div className="auth-captcha"><div ref={captchaContainer} /><small>Une vérification anti-abus peut être demandée après plusieurs tentatives.</small></div>}
          {mode === "register" && <label className="auth-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />J’accepte la <Link href="/privacy" target="_blank">politique de confidentialité</Link> et les <Link href="/terms" target="_blank">conditions d’utilisation</Link>.</label>}
          {mode === "forgot" && recoveryDeadline > 0 && <div className="auth-expiry" role="status"><span>Le lien est valable encore {recoverySeconds > 0 ? formatRemaining(recoverySeconds) : "jusqu’à 1 heure"}.</span><button type="button" className="auth-resend" disabled={busy || resendSeconds > 0} onClick={() => formRef.current?.requestSubmit()}>{resendSeconds > 0 ? `Renvoyer dans ${resendSeconds}s` : "Renvoyer un nouveau lien"}</button></div>}
          {mode === "reset" && resetDeadline > 0 && <div className={`auth-expiry${resetExpired ? " expired" : ""}`} role="status"><span>{resetExpired ? "Ce lien a expiré." : `Ce lien expire dans ${formatRemaining(Math.ceil((resetDeadline - clock) / 1000))}.`}</span>{resetExpired && <button type="button" className="auth-resend" onClick={() => switchMode("forgot")}>Demander un nouveau lien</button>}</div>}
          <button className="auth-submit" disabled={busy || resetExpired}>{busy ? "Veuillez patienter…" : mode === "register" ? (signupStep === "email" ? "Recevoir le code" : signupStep === "code" ? "Valider le code" : "Créer mon compte") : mode === "forgot" ? "Envoyer le lien" : "Se connecter"}</button>
        </form>
        {mode === "login" && <button className="auth-forgot" onClick={() => switchMode("forgot")}>Mot de passe oublié ?</button>}
        {mode === "forgot" && <button className="auth-forgot" onClick={() => switchMode("login")}>Retour à la connexion</button>}
      </div>
    </section>
    <footer className="auth-footer"><span>Fala AI · Données privées et contrôle utilisateur</span><span><Link href="/privacy">Confidentialité</Link><Link href="/terms">Conditions</Link></span></footer>
  </main>;
}

export default function AuthPage() {
  return <Suspense fallback={<main className="auth-shell" aria-busy="true" /> }><AuthPageContent /></Suspense>;
}
