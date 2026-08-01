"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { csrfFetch } from "../csrf-client";
type User={email:string;display_name:string;created_at:string;last_seen_at:string;suspended_at:string|null;suspension_reason:string|null;consented_at:string|null};
type Report={id:number;user_email:string;category:string;message:string;status:string;admin_note:string;created_at:string;updated_at:string};
type ErrorEvent={id:number;user_email:string|null;route:string;message:string;created_at:string};
type Role={user_email:string;role:string;granted_by:string;created_at:string};
type Activity={user_email:string;event_type:string;description:string;created_at:string};
type AdminData={connection:{status:string;source:string;checkedAt:string};summary:{users:number;active7d:number;applications:number;newApplications7d:number};statuses:Array<{status:string;count:number}>;recentUsers:User[];activity:Activity[];reports:Report[];errors:ErrorEvent[];roles:Role[]};
const TAB_SESSION_KEY="fala_tab_session";

const date=(value:string)=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));

export default function AdminPage(){
  const [data,setData]=useState<AdminData|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [query,setQuery]=useState("");const [busy,setBusy]=useState("");
  async function load(){
    setLoading(true);
    // Cookies are shared between tabs, so a copied /admin URL must still
    // establish a fresh authentication context in the new tab before any
    // administrative data is requested or rendered.
    if(!window.sessionStorage.getItem(TAB_SESSION_KEY)){
      window.location.replace(`/auth?reauth=1&next=${encodeURIComponent("/admin")}`);
      return;
    }
    const response=await csrfFetch("/api/admin/overview",{cache:"no-store"});const body=await response.json();if(!response.ok)setError(body.error??"Accès impossible");else{setData(body);setError("");}setLoading(false);
  }
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[]);
  const users=useMemo(()=>data?.recentUsers.filter((user)=>`${user.display_name} ${user.email}`.toLowerCase().includes(query.toLowerCase()))??[],[data,query]);
  const activities=useMemo(()=>data?.activity.filter((item)=>`${item.user_email} ${item.description} ${item.event_type}`.toLowerCase().includes(query.toLowerCase()))??[],[data,query]);
  async function userAction(email:string,action:"suspend"|"reactivate"|"setRole",role?:string){setBusy(email);const reason=action==="suspend"?window.prompt("Motif de suspension :","Examen administratif en cours")??"":undefined;if(action==="suspend"&&!reason){setBusy("");return;}const response=await csrfFetch(`/api/admin/users/${encodeURIComponent(email)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action,role,reason})});const body=await response.json();setBusy("");if(!response.ok){setError(body.error??"Action impossible");return;}await load();}
  async function updateReport(id:number,status:string){setBusy(`report-${id}`);const response=await csrfFetch(`/api/admin/reports/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});const body=await response.json();setBusy("");if(!response.ok){setError(body.error??"Mise à jour impossible");return;}await load();}
  if(loading&&!data)return <main className="admin-shell"><div className="public-loader"><span className="brand-mark">F</span><p>Chargement du centre de contrôle…</p></div></main>;
  if(error&&!data)return <main className="admin-shell"><div className="admin-denied"><span>!</span><h1>Accès refusé</h1><p>{error}</p><Link href="/">Retour à la plateforme</Link></div></main>;
  if(!data)return null;
  const admins=new Set(data.roles.filter((role)=>role.role==="admin").map((role)=>role.user_email.toLowerCase()));
  return <main className="admin-shell"><div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div><header className="admin-top"><div className="brand"><span className="brand-mark">F</span><span>Fala <b>Admin</b></span></div><div><a href="/api/admin/export" download>↓ Export CSV</a><a href="/api/admin/backup" download>↓ Sauvegarde JSON</a><button onClick={()=>void load()}>↻ Actualiser</button><Link href="/">← Espace utilisateur</Link></div></header><div className="admin-wrap">
    <div className="admin-heading"><div><span>ADMINISTRATION FALA AI</span><h1>Centre de contrôle</h1><p>Recherchez, examinez et agissez sur l’activité réelle de la plateforme.</p></div><span className="admin-live"><i/>Connecté à {data.connection.source}</span></div>
    {error&&<div className="error-banner">{error}<button onClick={()=>setError("")}>×</button></div>}
    <section className="admin-metrics"><article><span>UTILISATEURS</span><strong>{data.summary.users}</strong><small>{data.summary.active7d} actifs sur 7 jours</small></article><article><span>CANDIDATURES</span><strong>{data.summary.applications}</strong><small>{data.summary.newApplications7d} créées sur 7 jours</small></article><article><span>SIGNALEMENTS</span><strong>{data.reports.filter((report)=>report.status==="open").length}</strong><small>ouverts à traiter</small></article><article><span>ERREURS</span><strong>{data.errors.length}</strong><small>événements techniques récents</small></article></section>
    <label className="admin-search">⌕<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Rechercher un utilisateur ou filtrer son activité…"/></label>
    <section className="admin-grid"><article className="admin-panel"><div className="admin-panel-title"><div><h2>Gestion des utilisateurs</h2><p>Comptes, consentement, suspension et rôles</p></div><span>{users.length}</span></div><div className="admin-table"><table><thead><tr><th>UTILISATEUR</th><th>DERNIÈRE ACTIVITÉ</th><th>ÉTAT</th><th>ACTIONS</th></tr></thead><tbody>{users.map((user)=>{const isAdmin=admins.has(user.email.toLowerCase());return <tr key={user.email}><td><strong>{user.display_name}</strong><small>{user.email}</small></td><td>{date(user.last_seen_at)}</td><td><span className={`admin-state ${user.suspended_at?"blocked":"active"}`}>{user.suspended_at?"Suspendu":user.consented_at?"Actif":"Consentement requis"}</span>{isAdmin&&<small>Administrateur</small>}</td><td><div className="admin-actions"><button onClick={()=>setQuery(user.email)} title="Filtrer le journal sur cet utilisateur">Voir activité</button>{user.suspended_at?<button onClick={()=>void userAction(user.email,"reactivate")} disabled={busy===user.email}>Réactiver</button>:<button className="warn" onClick={()=>void userAction(user.email,"suspend")} disabled={busy===user.email}>Suspendre</button>}<button onClick={()=>void userAction(user.email,"setRole",isAdmin?"user":"admin")} disabled={busy===user.email}>{isAdmin?"Retirer admin":"Nommer admin"}</button></div></td></tr>})}</tbody></table>{!users.length&&<p className="admin-empty">Aucun utilisateur correspondant.</p>}</div></article><article className="admin-panel"><div className="admin-panel-title"><div><h2>Pipeline global</h2><p>Répartition des candidatures</p></div></div><div className="admin-statuses">{data.statuses.map((item)=><div key={item.status}><span>{item.status}</span><div><i style={{width:`${data.summary.applications?Math.max(5,item.count/data.summary.applications*100):0}%`}}/></div><b>{item.count}</b></div>)}{!data.statuses.length&&<p className="admin-empty">Aucune candidature.</p>}</div></article></section>
    <section className="admin-grid admin-secondary"><article className="admin-panel"><div className="admin-panel-title"><div><h2>Signalements</h2><p>Demandes transmises par les utilisateurs</p></div><span>{data.reports.length}</span></div><div className="report-list">{data.reports.map((report)=><article key={report.id}><div><span>{report.category}</span><strong>{report.user_email}</strong><p>{report.message}</p><time>{date(report.created_at)}</time></div><select value={report.status} disabled={busy===`report-${report.id}`} onChange={(event)=>void updateReport(report.id,event.target.value)}><option value="open">Ouvert</option><option value="in_progress">En cours</option><option value="resolved">Résolu</option><option value="dismissed">Classé</option></select></article>)}{!data.reports.length&&<p className="admin-empty">Aucun signalement.</p>}</div></article><article className="admin-panel"><div className="admin-panel-title"><div><h2>Erreurs techniques</h2><p>Journal conservé pendant 90 jours</p></div><span>{data.errors.length}</span></div><div className="error-log">{data.errors.map((item)=><article key={item.id}><strong>{item.route}</strong><p>{item.message}</p><small>{item.user_email||"anonyme"} · {date(item.created_at)}</small></article>)}{!data.errors.length&&<p className="admin-empty">Aucune erreur enregistrée.</p>}</div></article></section>
    <section className="admin-panel activity-panel"><div className="admin-panel-title"><div><h2>Journal d’activité</h2><p>Filtré par la recherche ci-dessus</p></div></div><div className="activity-list">{activities.map((item,index)=><div key={`${item.created_at}-${index}`}><span className="activity-dot"/><div><strong>{item.description}</strong><small>{item.user_email} · {item.event_type}</small></div><time>{date(item.created_at)}</time></div>)}{!activities.length&&<p className="admin-empty">Aucune activité correspondante.</p>}</div></section>
    </div></main>;
}
