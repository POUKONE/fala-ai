"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Application = {
  id:number; company:string; role:string; location:string; contract_type:string; source:string;
  required_skills:string; experience_required:string; education_required:string; languages:string;
  sector:string; salary_min:number; status:string; applied_at:string|null; next_action_at:string|null;
  interview_at:string|null; score:number|null; score_breakdown:string|null; notes:string;
  created_at:string; updated_at:string;
};

type Profile = {
  target_title:string; location:string; contract_type:string; skills:string; experience_level:string;
  education_level:string; languages:string; sectors:string; salary_min:number;
};

type ActivityEvent = { event_type:string; description:string; created_at:string };

const statuses = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
const educationLevels = ["Bac","Bac+1","Bac+2","Bac+3","Bac+4","Bac+5","Bac+6","Bac+7","Bac+8 et plus"];
const scoreMaximums:Record<string,number> = {skills:30,title:15,experience:15,education:10,location:10,contract:10,languages:5,sector:3,salary:2};
const scoreNames:Record<string,string> = {skills:"Compétences",title:"Intitulé du poste",experience:"Expérience",education:"Études",location:"Localisation",contract:"Contrat",languages:"Langues",sector:"Secteur",salary:"Salaire"};

function formatDate(value:string|null) {
  if (!value) return "Aucune échéance";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle:"medium", timeStyle:value.includes("T")?"short":undefined }).format(new Date(value));
}

function scoreLabel(score:number|null) {
  if (score === null) return "Profil requis";
  if (score >= 90) return "Prioritaire";
  if (score >= 75) return "Très bon match";
  if (score >= 60) return "Match possible";
  return "À examiner";
}

export default function Home() {
  const [currentUser,setCurrentUser] = useState<{displayName:string;email:string}|null>(null);
  const [isAdmin,setIsAdmin] = useState(false);
  const [authChecked,setAuthChecked] = useState(false);
  const [applications,setApplications] = useState<Application[]>([]);
  const [activity,setActivity] = useState<ActivityEvent[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("Toutes");
  const [view,setView] = useState<"list"|"kanban">("list");
  const [modal,setModal] = useState<"add"|"profile"|null>(null);
  const [selected,setSelected] = useState<Application|null>(null);
  const [saving,setSaving] = useState(false);
  const [toast,setToast] = useState("");

  const notify = (message:string) => { setToast(message); window.setTimeout(()=>setToast(""),2600); };

  const loadData = useCallback(async () => {
    setError("");
    try {
      const meResponse = await fetch("/api/me",{cache:"no-store"});
      const meData = await meResponse.json();
      setCurrentUser(meData.user ?? null); setIsAdmin(Boolean(meData.isAdmin)); setAuthChecked(true);
      if (!meData.user) { setApplications([]); setProfile(null); setActivity([]); return; }
      const [appsResponse,profileResponse,activityResponse] = await Promise.all([fetch("/api/applications",{cache:"no-store"}),fetch("/api/profile",{cache:"no-store"}),fetch("/api/activity",{cache:"no-store"})]);
      if (!appsResponse.ok || !profileResponse.ok || !activityResponse.ok) throw new Error(appsResponse.status===401?"Votre session a expiré. Reconnectez-vous.":"Impossible de charger vos données.");
      const appsData = await appsResponse.json(); const profileData = await profileResponse.json(); const activityData = await activityResponse.json();
      setApplications(appsData.applications ?? []); setProfile(profileData.profile ?? null); setActivity(activityData.activity ?? []);
    } catch (cause) { setError(cause instanceof Error?cause.message:"Erreur inattendue"); }
    finally { setLoading(false); }
  },[]);

  useEffect(()=>{ const timer=window.setTimeout(()=>void loadData(),0); return()=>window.clearTimeout(timer); },[loadData]);

  const filtered = useMemo(()=>applications.filter((item)=>{
    const matchesQuery = `${item.company} ${item.role} ${item.location}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter==="Toutes"||item.status===filter);
  }),[applications,query,filter]);

  const metrics = useMemo(()=>({
    active:applications.filter((a)=>!["Refusée","Archivée"].includes(a.status)).length,
    sent:applications.filter((a)=>["Envoyée","Entretien","Offre"].includes(a.status)).length,
    interviews:applications.filter((a)=>a.status==="Entretien").length,
    offers:applications.filter((a)=>a.status==="Offre").length,
  }),[applications]);
  const responseRate = metrics.sent ? Math.round(applications.filter((a)=>["Entretien","Offre","Refusée"].includes(a.status)).length/metrics.sent*100) : 0;
  const interviewRate = metrics.sent ? Math.round(metrics.interviews/metrics.sent*100) : 0;

  async function addApplication(form:FormData) {
    setSaving(true); setError("");
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/applications",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error??"Ajout impossible"); return; }
    setApplications((current)=>[data.application,...current]); setModal(null); notify("Candidature enregistrée durablement");
  }

  async function saveProfile(form:FormData) {
    setSaving(true); setError("");
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/profile",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    setSaving(false);
    if (!response.ok) { const data=await response.json(); setError(data.error??"Enregistrement impossible"); return; }
    setProfile({target_title:String(payload.targetTitle||""),location:String(payload.location||""),contract_type:String(payload.contractType||""),skills:String(payload.skills||""),experience_level:String(payload.experienceLevel||""),education_level:String(payload.educationLevel||""),languages:String(payload.languages||""),sectors:String(payload.sectors||""),salary_min:Number(payload.salaryMin||0)});
    const refreshed = await fetch("/api/applications",{cache:"no-store"});
    if (refreshed.ok) { const body=await refreshed.json(); setApplications(body.applications??[]); }
    setModal(null); notify("Profil enregistré et scores recalculés");
  }

  async function updateApplication(form:FormData) {
    if (!selected) return;
    setSaving(true); const payload=Object.fromEntries(form.entries());
    const response=await fetch(`/api/applications/${selected.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json(); setSaving(false);
    if(!response.ok){setError(data.error??"Mise à jour impossible");return;}
    setApplications((current)=>current.map((a)=>a.id===selected.id?data.application:a)); setSelected(data.application); notify("Candidature mise à jour");
  }

  async function removeApplication() {
    if(!selected||!window.confirm(`Supprimer définitivement la candidature ${selected.role} chez ${selected.company} ?`)) return;
    const response=await fetch(`/api/applications/${selected.id}`,{method:"DELETE"});
    if(!response.ok){setError("Suppression impossible");return;}
    setApplications((current)=>current.filter((a)=>a.id!==selected.id)); setSelected(null); notify("Candidature supprimée");
  }

  if (!authChecked || loading) return <main className="public-shell"><div className="public-loader"><span className="brand-mark">J</span><p>Ouverture de JobTracker AI…</p></div></main>;

  if (!currentUser) return <main className="public-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <header className="public-nav"><div className="brand"><span className="brand-mark">J</span><span>JobTracker <b>AI</b></span></div><div className="public-auth-links"><a className="public-login" href="/signin-with-chatgpt?return_to=%2F">Connexion</a><a className="public-register" href="/signin-with-chatgpt?return_to=%2F">Créer un compte</a></div></header>
    <section className="public-hero"><div className="public-copy"><span className="public-kicker">SUIVI INTELLIGENT DES CANDIDATURES</span><h1>Votre recherche d’emploi.<br/><em>Enfin sous contrôle.</em></h1><p>Centralisez vos candidatures, calculez leur compatibilité et pilotez chaque prochaine action depuis un espace privé.</p><div className="public-actions"><a className="public-cta" href="/signin-with-chatgpt?return_to=%2F">Créer mon espace →</a><span>Identité vérifiée · Données isolées · Historique conservé</span></div></div><div className="public-orbit" aria-hidden="true"><div className="public-core"><span>94</span><small>MATCH</small></div><i className="orbit-card one">Candidature</i><i className="orbit-card two">Entretien</i><i className="orbit-card three">Offre</i></div></section>
    <section className="public-features"><article><span>01</span><h2>Pipeline vivant</h2><p>Liste, Kanban, statuts et échéances restent synchronisés avec vos données.</p></article><article><span>02</span><h2>Scoring explicable</h2><p>Chaque score s’appuie sur vos compétences, votre expérience et vos préférences.</p></article><article><span>03</span><h2>Suivi personnel</h2><p>Vos candidatures appartiennent uniquement à votre compte authentifié.</p></article></section>
  </main>;

  return <main className="app-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">J</span><span>JobTracker <b>AI</b></span></div>
      <nav aria-label="Navigation principale">
        <a className="nav-item active" href="#dashboard"><span className="icon">⌂</span>Vue d’ensemble</a>
        <a className="nav-item" href="#applications"><span className="icon">▱</span>Candidatures<span className="nav-badge">{applications.length}</span></a>
        <a className="nav-item" href="#analytics"><span className="icon">↗</span>Statistiques</a>
        {isAdmin&&<a className="nav-item admin-link" href="/admin"><span className="icon">◈</span>Administration</a>}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item sync-button" onClick={()=>void loadData()}><span className="icon">↻</span>Actualiser les données<span className="status-dot"/></button>
        <button className="nav-item sync-button" onClick={()=>setModal("profile")}><span className="icon">⚙</span>Profil de scoring</button>
        <a className="nav-item" href="/signout-with-chatgpt?return_to=%2F"><span className="icon">↪</span>Se déconnecter</a>
      </div>
    </aside>

    <section className="content" id="dashboard">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">J</span> JobTracker AI</div>
        <label className="search"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Rechercher dans vos candidatures…"/></label>
        <div className="top-actions"><span className="live"><i/>{currentUser.displayName}</span><button className="primary" onClick={()=>setModal("add")}>＋ Ajouter</button></div>
      </header>

      <div className="page-wrap">
        <div className="welcome-row"><div><p className="eyebrow">ESPACE DE TRAVAIL SÉCURISÉ</p><h1>Votre recherche, sous contrôle.</h1><p>Vos données et votre historique restent associés à votre identité, même après une longue déconnexion.</p></div><button className="ghost-button" onClick={()=>setModal("profile")}>{profile?"Modifier mon profil":"Configurer mon profil"} →</button></div>

        {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
        {!profile&&!loading&&<section className="focus-card setup-card"><div className="focus-copy"><span className="focus-label"><i/>ÉTAPE REQUISE</span><h2>Configurez votre profil pour activer le scoring automatique</h2><p>Compétences, localisation, contrat, expérience et salaire sont comparés à chaque offre.</p><div className="focus-actions"><button onClick={()=>setModal("profile")}>Configurer maintenant →</button></div></div><div className="time-orbit"><div className="orbit-ring"><div><b>0→100</b><small>score explicable</small></div></div></div></section>}

        <section className="metric-grid" aria-label="Indicateurs réels">
          <article className="metric"><div className="metric-head"><span className="metric-icon purple">▱</span><span className="metric-tag">ACTIVES</span></div><strong>{metrics.active}</strong><p>Candidatures actives</p><small>{applications.length} enregistrées au total</small></article>
          <article className="metric"><div className="metric-head"><span className="metric-icon coral">✉</span><span className="metric-tag">CALCULÉ</span></div><strong>{responseRate}%</strong><p>Taux de réponse</p><small>Entretiens, offres et refus / envois</small></article>
          <article className="metric"><div className="metric-head"><span className="metric-icon blue">▦</span><span className="metric-tag">EN COURS</span></div><strong>{metrics.interviews}</strong><p>Entretiens</p><small>{interviewRate}% des candidatures envoyées</small></article>
          <article className="metric"><div className="metric-head"><span className="metric-icon amber">★</span><span className="metric-tag">RÉSULTAT</span></div><strong>{metrics.offers}</strong><p>Offres reçues</p><small>Issues de vos données enregistrées</small></article>
        </section>

        <section className="applications-section" id="applications">
          <div className="section-title applications-title"><div><h2>Vos candidatures</h2><p>Créez, mettez à jour et retrouvez vos données après chaque connexion.</p></div><div className="view-toggle"><button className={view==="list"?"selected":""} onClick={()=>setView("list")}>☷ Liste</button><button className={view==="kanban"?"selected":""} onClick={()=>setView("kanban")}>▥ Kanban</button></div></div>
          <div className="filters" role="group" aria-label="Filtrer par statut">{["Toutes",...statuses].map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}</button>)}</div>
          {loading?<div className="state-panel">Chargement de vos données…</div>:applications.length===0?<div className="state-panel empty-state"><span>＋</span><h3>Votre pipeline est vide</h3><p>Ajoutez votre première candidature. Elle sera enregistrée dans votre espace privé.</p><button className="primary" onClick={()=>setModal("add")}>Ajouter une candidature</button></div>:view==="list"?<div className="table-wrap"><table><thead><tr><th>ENTREPRISE & POSTE</th><th>STATUT</th><th>SCORE</th><th>SOURCE</th><th>PROCHAINE ACTION</th><th/></tr></thead><tbody>{filtered.map((a)=><tr key={a.id}><td><button className="company-cell table-button" onClick={()=>setSelected(a)}><span className="company-logo small violet">{a.company.slice(0,1).toUpperCase()}</span><span><strong>{a.role}</strong><small>{a.company} · {a.location||"Localisation non précisée"}</small></span></button></td><td><span className={`status ${a.status.toLowerCase().replace("à ","").replaceAll("é","e")}`}>{a.status}</span></td><td><button className="score compact" onClick={()=>setSelected(a)}>{a.score??"—"}</button></td><td>{a.source}</td><td><strong className="next-action">{formatDate(a.next_action_at)}</strong></td><td><button className="row-action" onClick={()=>setSelected(a)} aria-label={`Ouvrir ${a.company}`}>•••</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">Aucun résultat pour ce filtre.</div>}</div>:<div className="kanban">{statuses.slice(0,5).map((status)=><div className="kanban-column" key={status}><h3>{status}<span>{filtered.filter((a)=>a.status===status).length}</span></h3>{filtered.filter((a)=>a.status===status).map((a)=><button className="kanban-card" key={a.id} onClick={()=>setSelected(a)}><span className="company-logo small violet">{a.company.slice(0,1).toUpperCase()}</span><strong>{a.role}</strong><small>{a.company}</small><div><span className="score compact">{a.score??"—"}</span><span>{formatDate(a.next_action_at)}</span></div></button>)}</div>)}</div>}
        </section>

        <section className="insight-row" id="analytics">
          <article className="insight-card"><div className="section-title"><div><h2>Répartition du pipeline</h2><p>Données actualisées</p></div></div><div className="status-bars">{statuses.slice(0,5).map((status)=>{const count=applications.filter((a)=>a.status===status).length;return <div key={status}><span>{status}</span><div><i style={{width:`${applications.length?Math.max(4,count/applications.length*100):0}%`}}/></div><b>{count}</b></div>})}</div></article>
          <article className="assistant-card"><span className="assistant-icon">✓</span><div><span className="focus-label">ÉTAT DU SYSTÈME</span><h3>{profile?"Scoring opérationnel":"Scoring en attente du profil"}</h3><p>{profile?"Chaque nouvelle candidature est comparée à votre profil et reçoit un détail pondéré sur 100.":"Complétez votre profil pour calculer des scores fondés sur vos critères réels."}</p><button onClick={()=>setModal("profile")}>{profile?"Mettre à jour mes critères":"Configurer le scoring"} →</button></div></article>
        </section>
        <section className="activity-card" id="activity"><div className="section-title"><div><h2>Votre historique d’activité</h2><p>Conservé dans votre espace personnel entre chaque connexion</p></div><span className="history-count">{activity.length}</span></div><div className="user-activity-list">{activity.slice(0,12).map((item,index)=><div key={`${item.created_at}-${index}`}><span className="activity-dot"/><div><strong>{item.description}</strong><small>{item.event_type}</small></div><time>{formatDate(item.created_at)}</time></div>)}{!activity.length&&<p className="admin-empty">Votre historique apparaîtra ici après vos premières actions.</p>}</div></section>
        <footer><span>JobTracker AI · Accès privé et données isolées par utilisateur</span><span><i/> Stockage persistant actif</span></footer>
      </div>
    </section>

    {modal==="profile"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="profile-title">Profil de scoring</h2><p>Ces critères servent au calcul automatique. Toute modification recalcule aussi vos candidatures existantes.</p><form action={saveProfile}><div className="form-grid"><label>Poste recherché<input name="targetTitle" defaultValue={profile?.target_title||""} required/></label><label>Localisation cible<input name="location" defaultValue={profile?.location||""} required/></label><label>Contrat<select name="contractType" defaultValue={profile?.contract_type||""} required><option value="">Choisir</option><option>CDI</option><option>CDD</option><option>Alternance</option><option>Stage</option><option>Freelance</option></select></label><label>Expérience<select name="experienceLevel" defaultValue={profile?.experience_level||""}><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationLevel" defaultValue={profile?.education_level||""}><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0" defaultValue={profile?.salary_min||0}/></label><label className="span-2">Compétences<input name="skills" defaultValue={profile?.skills||""} placeholder="Python, SQL, Power BI" required/></label><label>Langues<input name="languages" defaultValue={profile?.languages||""} placeholder="Français, Anglais"/></label><label>Secteurs<input name="sectors" defaultValue={profile?.sectors||""} placeholder="Tech, Santé"/></label></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer et recalculer"}</button></div></form></div></div>}

    {modal==="add"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">＋</span><h2 id="add-title">Ajouter une candidature</h2><p>Les champs de correspondance alimentent le score. Aucune information n’est inventée.</p><form action={addApplication}><div className="form-grid"><label>Entreprise<input name="company" required autoFocus/></label><label>Poste<input name="role" required/></label><label>Localisation<input name="location"/></label><label>Type de contrat<select name="contractType"><option value="">Non précisé</option><option>CDI</option><option>CDD</option><option>Alternance</option><option>Stage</option><option>Freelance</option></select></label><label>Source<input name="source" placeholder="LinkedIn, France Travail…"/></label><label>Statut<select name="status" defaultValue="À préparer">{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label className="span-2">Compétences demandées<input name="requiredSkills" placeholder="Python, SQL, dbt"/></label><label>Expérience demandée<select name="experienceRequired"><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationRequired"><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Langues<input name="languages"/></label><label>Secteur<input name="sector"/></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0"/></label><label>Date de candidature<input name="appliedAt" type="date"/></label><label>Prochaine action<input name="nextActionAt" type="datetime-local"/></label><label>Entretien<input name="interviewAt" type="datetime-local"/></label><label className="span-2">Notes<textarea name="notes" rows={3}/></label></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer durablement"}</button></div></form></div></div>}

    {selected&&<div className="modal-backdrop" onMouseDown={()=>setSelected(null)}><div className="modal score-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSelected(null)} aria-label="Fermer">×</button><div className="score-summary"><span className="score huge">{selected.score??"—"}<small>/100</small></span><div><span className="focus-label">{scoreLabel(selected.score)}</span><h2 id="detail-title">{selected.role}</h2><p>{selected.company} · {selected.location||"Localisation non précisée"}</p></div></div>{selected.score_breakdown&&<div className="score-bars">{Object.entries(JSON.parse(selected.score_breakdown) as Record<string,number>).map(([label,value])=><div key={label}><div><span>{scoreNames[label]??label}</span><b>{value} / {scoreMaximums[label]??10}</b></div><progress value={value} max={scoreMaximums[label]??10}/></div>)}</div>}<form action={updateApplication}><div className="form-grid"><label>Statut<select name="status" defaultValue={selected.status}>{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label>Prochaine action<input name="nextActionAt" type="datetime-local" defaultValue={selected.next_action_at?.slice(0,16)||""}/></label><label>Entretien<input name="interviewAt" type="datetime-local" defaultValue={selected.interview_at?.slice(0,16)||""}/></label><label className="span-2">Notes<textarea name="notes" rows={4} defaultValue={selected.notes}/></label></div><div className="modal-actions split-actions"><button type="button" className="danger-button" onClick={()=>void removeApplication()}>Supprimer</button><span/><button type="button" onClick={()=>setSelected(null)}>Fermer</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button></div></form></div></div>}
    {toast&&<div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}
