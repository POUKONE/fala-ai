"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AdminData = {
  summary:{users:number;active7d:number;applications:number;newApplications7d:number};
  statuses:Array<{status:string;count:number}>;
  recentUsers:Array<{email:string;display_name:string;created_at:string;last_seen_at:string}>;
  activity:Array<{user_email:string;event_type:string;description:string;created_at:string}>;
};

const date = (value:string) => new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));

export default function AdminPage() {
  const [data,setData]=useState<AdminData|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  async function load(){setLoading(true);const response=await fetch("/api/admin/overview",{cache:"no-store"});const body=await response.json();if(!response.ok)setError(body.error??"Accès impossible");else{setData(body);setError("");}setLoading(false);}
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[]);
  if(loading)return <main className="admin-shell"><div className="public-loader"><span className="brand-mark">J</span><p>Chargement du centre de contrôle…</p></div></main>;
  if(error)return <main className="admin-shell"><div className="admin-denied"><span>!</span><h1>Accès refusé</h1><p>{error}</p><Link href="/">Retour à la plateforme</Link></div></main>;
  if(!data)return null;
  return <main className="admin-shell"><div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div><header className="admin-top"><div className="brand"><span className="brand-mark">J</span><span>JobTracker <b>Admin</b></span></div><div><button onClick={()=>void load()}>↻ Actualiser</button><Link href="/">← Espace utilisateur</Link></div></header><div className="admin-wrap"><div className="admin-heading"><div><span>ADMINISTRATION</span><h1>Centre de contrôle</h1><p>Vue globale de l’activité, accessible uniquement à l’administrateur autorisé.</p></div><span className="admin-live"><i/>Système actif</span></div><section className="admin-metrics"><article><span>UTILISATEURS</span><strong>{data.summary.users}</strong><small>{data.summary.active7d} actifs sur 7 jours</small></article><article><span>CANDIDATURES</span><strong>{data.summary.applications}</strong><small>{data.summary.newApplications7d} créées sur 7 jours</small></article><article><span>ACTIVITÉ</span><strong>{data.activity.length}</strong><small>derniers événements affichés</small></article><article><span>TAUX ACTIF</span><strong>{data.summary.users?Math.round(data.summary.active7d/data.summary.users*100):0}%</strong><small>utilisateurs vus récemment</small></article></section><section className="admin-grid"><article className="admin-panel"><div className="admin-panel-title"><div><h2>Utilisateurs récents</h2><p>Inscription et dernière activité</p></div><span>{data.recentUsers.length}</span></div><div className="admin-table"><table><thead><tr><th>UTILISATEUR</th><th>INSCRIPTION</th><th>DERNIÈRE ACTIVITÉ</th></tr></thead><tbody>{data.recentUsers.map((user)=><tr key={user.email}><td><strong>{user.display_name}</strong><small>{user.email}</small></td><td>{date(user.created_at)}</td><td>{date(user.last_seen_at)}</td></tr>)}</tbody></table>{!data.recentUsers.length&&<p className="admin-empty">Aucun utilisateur inscrit.</p>}</div></article><article className="admin-panel"><div className="admin-panel-title"><div><h2>Pipeline global</h2><p>Répartition de toutes les candidatures</p></div></div><div className="admin-statuses">{data.statuses.map((item)=><div key={item.status}><span>{item.status}</span><div><i style={{width:`${data.summary.applications?Math.max(5,item.count/data.summary.applications*100):0}%`}}/></div><b>{item.count}</b></div>)}{!data.statuses.length&&<p className="admin-empty">Aucune candidature enregistrée.</p>}</div></article></section><section className="admin-panel activity-panel"><div className="admin-panel-title"><div><h2>Journal d’activité</h2><p>Actions importantes enregistrées par la plateforme</p></div></div><div className="activity-list">{data.activity.map((item,index)=><div key={`${item.created_at}-${index}`}><span className="activity-dot"/><div><strong>{item.description}</strong><small>{item.user_email} · {item.event_type}</small></div><time>{date(item.created_at)}</time></div>)}{!data.activity.length&&<p className="admin-empty">Aucune activité enregistrée.</p>}</div></section></div></main>;
}
