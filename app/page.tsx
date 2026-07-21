"use client";

import { useMemo, useState } from "react";

type Application = {
  id: number;
  company: string;
  initials: string;
  role: string;
  location: string;
  source: string;
  score: number;
  status: "À préparer" | "Envoyée" | "Entretien" | "Offre";
  date: string;
  accent: string;
};

const initialApplications: Application[] = [
  { id: 1, company: "Mistral AI", initials: "M", role: "Data Analyst", location: "Paris · Hybride", source: "LinkedIn", score: 94, status: "Entretien", date: "Aujourd’hui, 14:30", accent: "violet" },
  { id: 2, company: "Alan", initials: "A", role: "Product Data Analyst", location: "Paris · Télétravail", source: "Welcome", score: 89, status: "Envoyée", date: "Il y a 2 jours", accent: "blue" },
  { id: 3, company: "Back Market", initials: "B", role: "Junior Data Scientist", location: "Bordeaux · Hybride", source: "Indeed", score: 86, status: "À préparer", date: "Expire dans 4 j", accent: "green" },
  { id: 4, company: "Doctolib", initials: "D", role: "Analytics Engineer", location: "Paris · Hybride", source: "Carrière", score: 82, status: "Envoyée", date: "Il y a 6 jours", accent: "coral" },
];

const scoreParts = [
  ["Compétences", 28, 30], ["Expérience", 13, 15], ["Formation", 10, 10], ["Localisation", 10, 10], ["Contrat", 9, 10], ["Disponibilité", 10, 10], ["Langues & secteur", 9, 15],
];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [applications, setApplications] = useState(initialApplications);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filter, setFilter] = useState("Toutes");
  const [showModal, setShowModal] = useState(false);
  const [showScore, setShowScore] = useState<Application | null>(null);
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(() => applications.filter((application) => {
    const matchQuery = `${application.company} ${application.role}`.toLowerCase().includes(query.toLowerCase());
    const matchFilter = filter === "Toutes" || application.status === filter;
    return matchQuery && matchFilter;
  }), [applications, query, filter]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function syncNow() {
    setSyncing(true);
    window.setTimeout(() => {
      setSyncing(false);
      notify("Synchronisation terminée · 3 sources vérifiées");
    }, 1100);
  }

  function addApplication(form: FormData) {
    const company = String(form.get("company") || "Nouvelle entreprise");
    const role = String(form.get("role") || "Nouveau poste");
    const next: Application = {
      id: Date.now(), company, initials: company.slice(0, 1).toUpperCase(), role,
      location: String(form.get("location") || "À préciser"), source: "Ajout manuel",
      score: 76, status: "À préparer", date: "Ajoutée maintenant", accent: "violet",
    };
    setApplications([next, ...applications]);
    setShowModal(false);
    notify("Candidature ajoutée à votre pipeline");
  }

  return (
    <main className="app-shell">
      <div className="neural-field" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">J</span><span>JobTracker <b>AI</b></span></div>
        <nav aria-label="Navigation principale">
          <a className="nav-item active" href="#dashboard"><Icon>⌂</Icon>Vue d’ensemble</a>
          <a className="nav-item" href="#applications"><Icon>▱</Icon>Candidatures<span className="nav-badge">24</span></a>
          <a className="nav-item" href="#offers"><Icon>⌕</Icon>Offres recommandées<span className="dot" /></a>
          <a className="nav-item" href="#interviews"><Icon>▦</Icon>Entretiens</a>
          <a className="nav-item" href="#documents"><Icon>▤</Icon>Documents</a>
          <a className="nav-item" href="#analytics"><Icon>↗</Icon>Statistiques</a>
          <a className="nav-item" href="#automations"><Icon>✦</Icon>Automatisations</a>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item sync-button" onClick={syncNow}><Icon>↻</Icon>{syncing ? "Synchronisation…" : "Synchroniser"}<span className={syncing ? "status-dot pulse" : "status-dot"} /></button>
          <a className="nav-item" href="#settings"><Icon>⚙</Icon>Paramètres</a>
          <div className="profile-mini"><span className="avatar">IK</span><span><strong>Ibrahim K.</strong><small>Data Analyst</small></span><button aria-label="Menu du profil">•••</button></div>
        </div>
      </aside>

      <section className="content" id="dashboard">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">J</span> JobTracker AI</div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une candidature, une entreprise…" /></label>
          <div className="top-actions"><span className="live"><i />À jour</span><button className="icon-button" aria-label="Notifications">♢<span className="notification-dot" /></button><button className="primary" onClick={() => setShowModal(true)}>＋ Ajouter</button></div>
        </header>

        <div className="page-wrap">
          <div className="welcome-row">
            <div><p className="eyebrow">MARDI 21 JUILLET · NEURAL WORKSPACE 01</p><h1>Bonjour Ibrahim <span>👋</span></h1><p>Voici ce qui mérite votre attention aujourd’hui.</p><div className="concept-strip" aria-label="Principes de design"><span>NEUROPATH</span><span>EDGE / SPATIAL</span><span>ULTRA DETAIL</span><span>HYPERKIT SPEED</span></div></div>
            <button className="ghost-button" onClick={() => notify("Rapport hebdomadaire prêt à consulter")}>Voir mon rapport <span>→</span></button>
          </div>

          <section className="focus-card">
            <span className="focus-index" aria-hidden="true">01 / NOW</span>
            <div className="focus-copy"><span className="focus-label"><i />À FAIRE EN PRIORITÉ</span><h2>Votre entretien chez Mistral AI est aujourd’hui</h2><p>Entretien technique · 14:30 – 15:30 · Google Meet</p><div className="focus-actions"><button onClick={() => notify("Fiche de préparation ouverte")}>Ouvrir ma préparation <span>→</span></button><button className="text-button" onClick={() => notify("Rappel programmé 30 min avant")}>Programmer un rappel</button></div></div>
            <div className="time-orbit"><div className="orbit-ring"><span className="clock-dot" /><div><b>14:30</b><small>dans 2h 18</small></div></div></div>
          </section>

          <section className="metric-grid" aria-label="Indicateurs principaux">
            <article className="metric"><div className="metric-head"><span className="metric-icon purple">▱</span><span className="trend">↗ 12%</span></div><strong>{applications.length + 20}</strong><p>Candidatures actives</p><small>7 envoyées cette semaine</small></article>
            <article className="metric"><div className="metric-head"><span className="metric-icon coral">✉</span><span className="trend">↗ 8%</span></div><strong>42%</strong><p>Taux de réponse</p><small>+6 pts sur les 30 derniers jours</small></article>
            <article className="metric"><div className="metric-head"><span className="metric-icon blue">▦</span><span className="metric-tag">Cette semaine</span></div><strong>3</strong><p>Entretiens prévus</p><small>Prochain : aujourd’hui à 14:30</small></article>
            <article className="metric alert-metric"><div className="metric-head"><span className="metric-icon amber">↻</span><span className="urgent">2 urgentes</span></div><strong>5</strong><p>Relances à effectuer</p><button onClick={() => { setFilter("Envoyée"); notify("Candidatures à relancer affichées"); }}>Voir les relances →</button></article>
          </section>

          <section className="recommendations" id="offers">
            <div className="section-title"><div><span className="spark">✦</span><h2>Recommandées pour vous</h2><p>Sélectionnées selon votre profil, vos objectifs et vos préférences.</p></div><button onClick={() => notify("12 offres compatibles disponibles")}>Voir les 12 offres <span>→</span></button></div>
            <div className="offer-grid">
              <article className="offer-card featured"><div className="offer-top"><span className="company-logo m">M</span><span className="score high">94<small>/100</small></span></div><h3>Data Analyst — Product</h3><p>Mistral AI · Paris · Hybride</p><div className="chips"><span>Python</span><span>SQL</span><span>Looker</span><span>＋2</span></div><div className="offer-foot"><span>Publié il y a 3h</span><button onClick={() => setShowScore(initialApplications[0])}>Pourquoi ce score ?</button></div></article>
              <article className="offer-card"><div className="offer-top"><span className="company-logo a">A</span><span className="score">89<small>/100</small></span></div><h3>Product Data Analyst</h3><p>Alan · Paris · Télétravail</p><div className="chips"><span>SQL</span><span>dbt</span><span>Tableau</span><span>＋3</span></div><div className="offer-foot"><span>Publié hier</span><button onClick={() => setShowScore(initialApplications[1])}>Pourquoi ce score ?</button></div></article>
              <article className="offer-card"><div className="offer-top"><span className="company-logo b">B</span><span className="score">86<small>/100</small></span></div><h3>Junior Data Scientist</h3><p>Back Market · Bordeaux · Hybride</p><div className="chips"><span>Python</span><span>ML</span><span>BigQuery</span><span>＋2</span></div><div className="offer-foot"><span>Publié il y a 2 j</span><button onClick={() => setShowScore(initialApplications[2])}>Pourquoi ce score ?</button></div></article>
            </div>
          </section>

          <section className="applications-section" id="applications">
            <div className="section-title applications-title"><div><h2>Vos candidatures</h2><p>Suivez l’avancement et ne manquez aucune prochaine étape.</p></div><div className="view-toggle"><button className={view === "list" ? "selected" : ""} onClick={() => setView("list")}>☷ Liste</button><button className={view === "kanban" ? "selected" : ""} onClick={() => setView("kanban")}>▥ Kanban</button></div></div>
            <div className="filters" role="group" aria-label="Filtrer par statut">{["Toutes", "À préparer", "Envoyée", "Entretien", "Offre"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
            {view === "list" ? (
              <div className="table-wrap"><table><thead><tr><th>ENTREPRISE & POSTE</th><th>STATUT</th><th>SCORE</th><th>SOURCE</th><th>PROCHAINE ACTION</th><th /></tr></thead><tbody>{filtered.map((application) => <tr key={application.id}><td><div className="company-cell"><span className={`company-logo small ${application.accent}`}>{application.initials}</span><span><strong>{application.role}</strong><small>{application.company} · {application.location}</small></span></div></td><td><span className={`status ${application.status.toLowerCase().replace("à ", "").replace("é", "e")}`}>{application.status}</span></td><td><button className="score compact" onClick={() => setShowScore(application)}>{application.score}</button></td><td><span className="source">{application.source}</span></td><td><strong className="next-action">{application.date}</strong></td><td><button className="row-action" aria-label={`Actions pour ${application.company}`} onClick={() => notify(`Actions ouvertes pour ${application.company}`)}>•••</button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty">Aucune candidature ne correspond à ce filtre.</div>}</div>
            ) : (
              <div className="kanban">{["À préparer", "Envoyée", "Entretien", "Offre"].map((status) => <div className="kanban-column" key={status}><h3>{status}<span>{filtered.filter((a) => a.status === status).length}</span></h3>{filtered.filter((a) => a.status === status).map((a) => <article key={a.id}><span className={`company-logo small ${a.accent}`}>{a.initials}</span><strong>{a.role}</strong><small>{a.company}</small><div><span className="score compact">{a.score}</span><span>{a.date}</span></div></article>)}</div>)}</div>
            )}
          </section>

          <section className="insight-row" id="analytics">
            <article className="insight-card"><div className="section-title"><div><h2>Votre dynamique</h2><p>30 derniers jours</p></div><span className="trend-pill">↗ +18%</span></div><div className="mini-chart"><div style={{height:"35%"}}/><div style={{height:"48%"}}/><div style={{height:"41%"}}/><div style={{height:"64%"}}/><div style={{height:"58%"}}/><div style={{height:"82%"}}/><div style={{height:"76%"}}/></div><div className="chart-labels"><span>S1</span><span>S2</span><span>S3</span><span>S4</span></div></article>
            <article className="assistant-card"><span className="assistant-icon">✦</span><div><span className="focus-label">CONSEIL DE L’ASSISTANT</span><h3>Concentrez vos efforts sur LinkedIn</h3><p>Vos candidatures LinkedIn génèrent <strong>2,4× plus d’entretiens</strong> que les autres plateformes.</p><button onClick={() => notify("Analyse par plateforme affichée")}>Voir l’analyse complète →</button></div></article>
          </section>
          <footer><span>JobTracker AI · Vos données restent privées</span><span><i /> Dernière synchronisation il y a 2 min</span></footer>
        </div>
      </section>

      {showModal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setShowModal(false)} aria-label="Fermer">×</button><span className="modal-icon">＋</span><h2 id="modal-title">Ajouter une candidature</h2><p>Enregistrez une offre en quelques secondes. Le score sera calculé automatiquement.</p><form action={addApplication}><label>Entreprise<input name="company" required placeholder="Ex. Qonto" autoFocus /></label><label>Intitulé du poste<input name="role" required placeholder="Ex. Data Analyst" /></label><label>Localisation<input name="location" placeholder="Ex. Paris · Hybride" /></label><div className="modal-actions"><button type="button" onClick={() => setShowModal(false)}>Annuler</button><button className="primary" type="submit">Ajouter au pipeline</button></div></form></div></div>}

      {showScore && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowScore(null)}><div className="modal score-modal" role="dialog" aria-modal="true" aria-labelledby="score-title" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setShowScore(null)} aria-label="Fermer">×</button><div className="score-summary"><span className="score huge">{showScore.score}<small>/100</small></span><div><span className="focus-label">TRÈS BONNE CORRESPONDANCE</span><h2 id="score-title">Pourquoi ce poste vous correspond</h2><p>{showScore.role} · {showScore.company}</p></div></div><div className="score-bars">{scoreParts.map(([label, value, total]) => <div key={String(label)}><div><span>{label}</span><b>{value}/{total}</b></div><progress value={Number(value)} max={Number(total)} /></div>)}</div><div className="score-note"><span>✦</span><p><strong>Votre force :</strong> vos compétences Python, SQL et visualisation couvrent 93 % des critères clés. Pensez à mettre en avant votre projet de prévision dans le CV.</p></div><button className="primary full" onClick={() => { setShowScore(null); setShowModal(true); }}>Préparer cette candidature</button></div></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
