"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function VerifyPage() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setState("error"); return; }
    fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then((response) => setState(response.ok ? "ok" : "error"))
      .catch(() => setState("error"));
  }, []);
  return <main className="account-state"><span className="brand-mark">F</span>{state === "loading" && <><h1>Vérification en cours…</h1><p>Nous activons votre adresse e-mail.</p></>}{state === "ok" && <><h1>Adresse vérifiée</h1><p>Votre compte Fala AI est prêt.</p><Link href="/">Ouvrir mon espace →</Link></>}{state === "error" && <><h1>Lien invalide</h1><p>Ce lien est expiré ou a déjà été utilisé.</p><Link href="/auth">Retour à la connexion</Link></>}</main>;
}
