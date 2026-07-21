"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "login" | "register" | "forgot" | "reset";

export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : params.get("mode") === "reset" ? "reset" : "login");
  const [resetToken] = useState(params.get("token") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function switchMode(next: Mode) {
    setMode(next); setMessage(""); setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const endpoint = mode === "register" ? "/api/auth/register" : mode === "forgot" ? "/api/auth/forgot" : mode === "reset" ? "/api/auth/reset-password" : "/api/auth/login";
    const body = mode === "register" ? { email, password, displayName: name, consent } : mode === "reset" ? { token: resetToken, password } : { email, password };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Impossible de traiter la demande.");
      if (mode === "forgot") { setMessage(data.message || "Si cette adresse existe, un lien de récupération a été envoyé."); }
      else if (mode === "reset") { setMessage("Mot de passe modifié. Vous pouvez vous connecter."); switchMode("login"); }
      else { router.push("/"); router.refresh(); }
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
          <label>Adresse e-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          {mode !== "forgot" && <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete={mode === "register" || mode === "reset" ? "new-password" : "current-password"} required /><small>8 caractères minimum</small></label>}
          {mode === "register" && <label className="auth-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />J’accepte la <Link href="/privacy" target="_blank">politique de confidentialité</Link> et les <Link href="/terms" target="_blank">conditions d’utilisation</Link>.</label>}
          <button className="auth-submit" disabled={busy}>{busy ? "Veuillez patienter…" : mode === "register" ? "Créer mon compte" : mode === "forgot" ? "Envoyer le lien" : "Se connecter"}</button>
        </form>
        {mode === "login" && <button className="auth-forgot" onClick={() => switchMode("forgot")}>Mot de passe oublié ?</button>}
        {mode === "forgot" && <button className="auth-forgot" onClick={() => switchMode("login")}>Retour à la connexion</button>}
      </div>
    </section>
    <footer className="auth-footer"><span>Fala AI · Données privées et contrôle utilisateur</span><span><Link href="/privacy">Confidentialité</Link><Link href="/terms">Conditions</Link></span></footer>
  </main>;
}
