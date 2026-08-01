"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { csrfFetch } from "../csrf-client";
type Mode = "login" | "register" | "forgot" | "reset";

declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string; reset?: (widgetId?: string) => void };
  }
}

function AuthPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : params.get("mode") === "reset" ? "reset" : "login");
  // Read the token from the current URL on every render. Keeping it in state
  // can leave it empty after the browser hydrates a password-reset link.
  const resetToken = params.get("token") ?? "";
  const [supabaseRecoveryToken, setSupabaseRecoveryToken] = useState("");
  useEffect(() => { const hash = new URLSearchParams(window.location.hash.replace(/^#/, "")); const token = hash.get("access_token") ?? ""; if (token && hash.get("type") === "recovery") { setSupabaseRecoveryToken(token); setMode("reset"); window.history.replaceState({}, "", `${window.location.pathname}?mode=reset`); } }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const endpoint = mode === "register" ? (signupStep === "email" ? "/api/auth/send-code" : signupStep === "code" ? "/api/auth/verify-code" : "/api/auth/register") : mode === "forgot" ? "/api/auth/forgot" : mode === "reset" ? "/api/auth/reset-password" : "/api/auth/login";
    const body = mode === "register" ? (signupStep === "email" ? { email, displayName: name, consent } : signupStep === "code" ? { email, code: password } : { email, password, displayName: name, consent }) : mode === "reset" ? { token: resetToken, accessToken: supabaseRecoveryToken, password } : { email, password, captchaToken };
    try {
      const response = await csrfFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setCaptchaRequired(Boolean(data.captchaRequired)); throw new Error(data.error || "Impossible de traiter la demande."); }
      if (mode === "forgot") { setMessage(data.message || "Si cette adresse existe, un lien de récupération a été envoyé."); }
      else if (mode === "reset") { setMode("login"); setMessage("Mot de passe modifié. Vous pouvez vous connecter."); }
      else if (mode === "register" && signupStep === "email") { setSignupStep("code"); setPassword(""); setMessage(data.message || "Un code de vérification vient d’être envoyé."); }
      else if (mode === "register" && signupStep === "code") { setSignupStep("password"); setPassword(""); setMessage(data.message || "Adresse vérifiée. Choisissez maintenant votre mot de passe."); }
      else if (mode === "register" && data.requiresEmailConfirmation) { setMode("login"); setMessage(data.message || "Votre compte est créé. Confirmez votre adresse e-mail avant de vous connecter."); }
      else { setCaptchaRequired(false); setCaptchaToken(""); router.push("/"); router.refresh(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Une erreur est survenue."); }
    finally { setBusy(false); }
  }

  const title = mode === "register" ? "Créer votre espace" : mode === "forgot" ? "Récupérer l’accès" : mode === "reset" ? "Nouveau mot de passe" : "Ravi de vous revoir";
  return <main className="auth-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <header className="auth-nav"><Link href="/" className="brand"><span className="brand-mark">F</span><span>Fala <b>AI</b></span></Link><Link href="/" className="auth-back">Retour à l’accueil</Link></header>
    <section className="auth-layout">
      <div className="auth-pitch"><span className="public-kicker">VOTRE RECHERCHE, SOUS CONTRÔLE</span><h1>Un espace privé,<br/><em>vraiment à vous.</em></h1><p>Retrouvez vos candidatures et votre historique à chaque connexion. Vos données restent isolées et exportables.</p><div className="auth-points"><span>✓ Compte e-mail autonome</span><span>✓ Connexion sécurisée</span><span>✓ Historique conservé</span></div></div>
      <div className="auth-card">
        <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Connexion</button><button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Inscription</button></div>
        <h2>{title}</h2><p className="auth-subtitle">{mode === "forgot" ? "Saisissez votre adresse et nous vous aiderons à retrouver votre compte." : "Utilisez votre adresse e-mail et un mot de passe."}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-success" role="status">{message}</div>}
        <form onSubmit={submit}>
          {mode === "register" && <label>Nom affiché<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>}
          {mode !== "reset" && <label>Adresse e-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>}
          {mode === "register" && signupStep === "code" && <label>Code reçu par e-mail<input inputMode="numeric" pattern="[0-9]{6}" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} maxLength={6} autoComplete="one-time-code" required /><small>Le code est valable 10 minutes</small></label>}
          {mode !== "forgot" && (mode !== "register" || signupStep === "password") && <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete={mode === "register" || mode === "reset" ? "new-password" : "current-password"} required /><small>8 caractères minimum</small></label>}
          {mode === "login" && captchaRequired && <div className="auth-captcha"><div ref={captchaContainer} /><small>Une vérification anti-abus peut être demandée après plusieurs tentatives.</small></div>}
          {mode === "register" && <label className="auth-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />J’accepte la <Link href="/privacy" target="_blank">politique de confidentialité</Link> et les <Link href="/terms" target="_blank">conditions d’utilisation</Link>.</label>}
          <button className="auth-submit" disabled={busy}>{busy ? "Veuillez patienter…" : mode === "register" ? (signupStep === "email" ? "Recevoir le code" : signupStep === "code" ? "Valider le code" : "Créer mon compte") : mode === "forgot" ? "Envoyer le lien" : "Se connecter"}</button>
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
