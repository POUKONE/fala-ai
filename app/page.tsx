"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import JSZip from "jszip";

import { csrfFetch } from "./csrf-client";
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
type ParsedOffer = {company?:string;role?:string;location?:string;contractType?:string;source?:string;requiredSkills?:string;experienceRequired?:string;educationRequired?:string;languages?:string;sector?:string;salaryMin?:number;notes?:string};
type NotificationReminder = {id:number;notification_id?:string;type:string;date:string;company:string;role:string;status:string;read?:boolean};
type CompatibilityReport = {percentage:number;matchingSkills:string[];missingSkills:string[];strengths:string[];gaps:string[];recommendation:string;criteria:{role:string|null;experience:string|null;education:string|null;contract:string|null}};
type AccountSession = {createdAt:string;lastSeenAt:string;expiresAt:string;device:string;current:boolean};

const statuses = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
const TAB_SESSION_KEY = "fala_tab_session";
const educationLevels = ["Bac","Bac+1","Bac+2","Bac+3","Bac+4","Bac+5","Bac+6","Bac+7","Bac+8 et plus"];
const sectorSuggestions = ["Tech","Data & IA","Finance","Banque","Assurance","Juridique","Santé","Industrie","Énergie","Retail","E-commerce","Conseil","Éducation","Transport","Immobilier","Télécom","Ressources humaines","Hôtellerie","Restauration","Communication","Marketing","Logistique","Aéronautique","Automobile","Construction","Public"];
const languageSuggestions = ["Français","Anglais","Espagnol","Allemand","Italien","Portugais","Arabe","Néerlandais","Chinois","Japonais"];
const contractSuggestions = ["CDI","CDD","Alternance","Stage","Freelance","Intérim"];
const locationSuggestions = ["Paris","Lyon","Marseille","Toulouse","Bordeaux","Lille","Nantes","Montpellier","Strasbourg","Nice","Rennes","Grenoble","France","Île-de-France","Télétravail","Hybride"];
const scoreMaximums:Record<string,number> = {skills:35,title:15,experience:15,location:10,education:10,contract:5,languages:5,salary:5};
const scoreOrder = ["skills","title","experience","location","education","contract","languages","salary"];
const scoreNames:Record<string,string> = {skills:"Compétences",title:"Intitulé du poste",experience:"Expérience",education:"Études",location:"Localisation",contract:"Contrat",languages:"Langues",sector:"Secteur",salary:"Salaire"};

function parseScoreBreakdown(value:unknown):Record<string,number>|null {
  if (!value) return null;
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const values = Object.fromEntries(Object.entries(parsed).flatMap(([key,item]) => {
    if(typeof item === "number") return [[key,item]];
    if(item && typeof item === "object" && !Array.isArray(item) && typeof (item as {weightedScore?:unknown}).weightedScore === "number") return [[key,(item as {weightedScore:number}).weightedScore]];
    return [];
  })) as Record<string,number>;
  return Object.fromEntries([...scoreOrder.filter((key)=>key in values), ...Object.keys(values).filter((key)=>!scoreOrder.includes(key))].map((key)=>[key,values[key]])) as Record<string,number>;
}

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

function readStoredIds(storage: Storage, key: string) {
  try { const value = JSON.parse(storage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

function writeStoredIds(storage: Storage, key: string, ids: string[]) {
  try { storage.setItem(key, JSON.stringify(ids.slice(-200))); } catch { /* le serveur reste la source de vérité */ }
}

type InterviewQuestion = { label:string; prompt:string; hint:string };
function interviewQuestions(application:Application):InterviewQuestion[] {
  const role = application.role || "ce poste";
  const skills = application.required_skills ? application.required_skills.split(/[,;\n]+/).map((item)=>item.trim()).filter(Boolean).slice(0,4).join(", ") : "vos compétences clés";
  const technical = /tech|data|ia|informat|dévelop|engineer|software|cyber|cloud|devops|sql|analyst|scient/i.test(`${application.role} ${application.sector} ${application.required_skills}`);
  const questions:InterviewQuestion[] = [
    {label:"Pitch · 60 secondes",prompt:`Présentez-vous en 60 secondes et expliquez pourquoi votre parcours correspond au poste de ${role}.`,hint:"PREP : Point de départ clair → raisons → exemple de preuve → lien avec le poste. Respirez, regardez la caméra ou le recruteur, puis concluez."},
    {label:"Motivation",prompt:`Pourquoi souhaitez-vous rejoindre ${application.company} sur ce poste ?`,hint:"Citez un élément concret de l’offre, reliez-le à votre expérience réelle et terminez par la valeur que vous voulez apporter."},
    {label:"Réussite · STAR",prompt:`Racontez une réalisation dont vous êtes fier et qui démontre ${skills}.`,hint:"STAR : Situation, Tâche, Actions (au ‘je’), Résultat. Ajoutez une métrique seulement si elle figure dans votre parcours."},
    {label:"Difficulté · apprentissage",prompt:"Parlez d’une difficulté professionnelle que vous avez résolue et de ce que vous en avez appris.",hint:"Ne cherchez pas la réponse parfaite : expliquez le contexte, votre décision, l’impact et ce que vous feriez encore mieux."},
    {label:"Collaboration",prompt:"Donnez un exemple de désaccord ou de collaboration difficile avec un collègue, un client ou une équipe.",hint:"Montrez l’écoute, les faits, la décision partagée et le résultat. Ne critiquez jamais une personne."},
  ];
  if (technical) {
    questions.push(
      {label:"Technique · cadrage",prompt:`Comment aborderiez-vous un problème technique lié au poste de ${role} avant d’écrire la première ligne de solution ?`,hint:"Clarifiez le besoin et les contraintes, annoncez vos hypothèses, proposez une approche simple puis vérifiez-la avec des tests."},
      {label:"Technique · arbitrage",prompt:"Présentez un choix technique que vous avez fait (ou que vous feriez) et expliquez les compromis.",hint:"Comparez au moins deux options avec des critères explicites : fiabilité, coût, délai, sécurité, maintenabilité et impact utilisateur."},
    );
  }
  questions.push({label:"Clôture",prompt:"Quelles questions pertinentes souhaitez-vous poser au recruteur et quelle prochaine étape proposez-vous ?",hint:"Préparez 2 questions : priorités des 90 premiers jours, critères de réussite et suite du processus. Terminez par un remerciement précis."});
  return questions;
}

function escapePdf(value:string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("œ","oe").replaceAll("Œ","OE").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }
function wrapPdfLine(value:string,maxLength=92) {
  const words=value.trim().split(/\s+/).filter(Boolean); const lines:string[]=[]; let current="";
  for(const word of words){ if(!current){current=word;continue;} if((current+" "+word).length<=maxLength) current+=` ${word}`; else {lines.push(current);current=word;} }
  if(current) lines.push(current); return lines.length?lines:[""];
}
function downloadBlob(blob:Blob, filename:string) { const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=filename; link.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
function createPdfBlob(text:string) {
  const lines=text.split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
  const headingPattern=/^(PROFIL|PROFIL CIBLE|COMPETENCES|COMPÉTENCES|EXPERIENCE|EXPÉRIENCE|FORMATION|CERTIFICATIONS?|LANGUES?|INFORMATIONS|AUTRES INFORMATIONS|AUTRES ELEMENTS|MOTS-CLÉS)/i;
  const firstHeading=lines.findIndex((line)=>headingPattern.test(line));
  const header=lines.slice(0,firstHeading<0?Math.min(4,lines.length):firstHeading);
  const sections:{title:string;items:string[]}[]=[];
  let current:{title:string;items:string[]}|null=null;
  for(const line of lines.slice(firstHeading<0?4:firstHeading)){ if(headingPattern.test(line)){current={title:line,items:[]};sections.push(current);} else if(current) current.items.push(line); }
  const navy="0.08 0.22 0.38";
  const ink="0.08 0.08 0.08";
  const commands:string[]=[]; let y=758;
  const add=(x:number,size:number,value:string,bold=false,color=ink)=>{if(y<45)return;commands.push(`${color} rg BT /${bold?"F2":"F1"} ${size} Tf ${x} ${y} Td (${escapePdf(value.slice(0,105))}) Tj ET`);y-=size+7;};
  add(50,27,header[0]??"CV",true,ink); if(header[1]) add(50,14,header[1],true,ink); if(header.slice(2).length){y-=4; add(50,9,header.slice(2).join("   "),false,ink);} y-=10;
  for(const section of sections){ if(y<80)break; commands.push(`${navy} rg 0.6 w 50 ${y+8} m 562 ${y+8} l S`); y-=18; add(50,13,section.title.toUpperCase(),true,navy); y-=2;
    if(/COMPETENCES|COMPÉTENCES/i.test(section.title)){ const skills=section.items.flatMap((item)=>item.split(/\s*[·•,;]\s*/).filter(Boolean)); const colWidth=170; const startY=y; skills.slice(0,18).forEach((skill,index)=>{const col=index%3; const row=Math.floor(index/3); const yy=startY-row*16; commands.push(`${ink} rg BT /F1 9 Tf ${50+col*colWidth} ${yy} Td (${escapePdf(skill.slice(0,28))}) Tj ET`);}); y=startY-Math.ceil(Math.min(skills.length,18)/3)*16-8; }
    else { for(const item of section.items.slice(0,14)){ for(const part of wrapPdfLine(item)) add(50,9,part); y-=2; } }
  }
  const commandsText=commands.join("\n");
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",`<< /Length ${commandsText.length} >>\nstream\n${commandsText}\nendstream`];
  let pdf="%PDF-1.4\n"; const offsets=[0]; objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}); const xref=pdf.length; pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf],{type:"application/pdf"});
}
function createApplicationsTablePdf(rows:Application[]) {
  const columns=["Entreprise","Poste","Statut","Score","Localisation"]; const widths=[125,185,85,55,146]; const x0=36; const headerY=728; const rowHeight=22; const commands:string[]=[];
  commands.push("0.08 0.22 0.38 rg", "BT /F2 18 Tf 36 770 Td (FALA AI - MES CANDIDATURES) Tj ET", "0.25 0.25 0.25 rg", "BT /F1 9 Tf 36 753 Td (Export lisible de vos candidatures) Tj ET", "0.08 0.22 0.38 rg", `36 ${headerY} 576 24 re f`);
  let x=x0; columns.forEach((column,index)=>{commands.push(`1 1 1 rg BT /F2 8 Tf ${x+4} ${headerY+8} Td (${escapePdf(column)}) Tj ET`);x+=widths[index];});
  rows.slice(0,30).forEach((row,index)=>{const y=headerY-(index+1)*rowHeight;let cellX=x0;if(index%2===0)commands.push("0.95 0.97 0.99 rg",`${x0} ${y} 576 ${rowHeight} re f`);const values=[row.company,row.role,row.status,row.score===null?"-":String(row.score)+"/100",row.location||"-"];values.forEach((value,cell)=>{commands.push("0.15 0.15 0.18 rg",`BT /F1 8 Tf ${cellX+4} ${y+7} Td (${escapePdf(String(value).slice(0,cell===1?30:22))}) Tj ET`);cellX+=widths[cell];});});
  commands.push("0.65 0.69 0.74 RG 0.5 w",`36 ${headerY} m 612 ${headerY} l S`,`36 ${headerY+24} m 612 ${headerY+24} l S`);for(let i=0;i<=Math.min(rows.length,30);i++){const y=headerY-i*rowHeight;commands.push(`36 ${y} m 612 ${y} l S`);}let gridX=x0;for(const width of widths){commands.push(`${gridX} ${headerY+24} m ${gridX} ${headerY-Math.min(rows.length,30)*rowHeight} l S`);gridX+=width;}commands.push("612 752 m 612 50 l S");
  if(rows.length>30)commands.push("0.35 0.35 0.35 rg",`BT /F1 8 Tf 36 38 Td (+ ${rows.length-30} candidatures supplémentaires non affichées dans cet aperçu) Tj ET`);
  const stream=commands.join("\n"); const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];let pdf="%PDF-1.4\n";const offsets:number[]=[];objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=String(index+1)+" 0 obj\n"+object+"\nendobj\n";});const xref=pdf.length;pdf+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n"+offsets.map((offset)=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")+"\ntrailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";return new Blob([pdf],{type:"application/pdf"});
}
function downloadPdf(text:string) { previewPdf(text); }
function downloadApplicationsPdf(rows:Application[]) {
  downloadBlob(createApplicationsTablePdf(rows),"fala-ai-candidatures.pdf");
}
function previewPdf(text:string) {
  const url=URL.createObjectURL(createPdfBlob(text));
  const overlay=document.createElement("div");
  overlay.setAttribute("role","dialog"); overlay.setAttribute("aria-label","Aperçu PDF du CV adapté");
  Object.assign(overlay.style,{position:"fixed",inset:"0",zIndex:"100",display:"flex",flexDirection:"column",gap:"12px",padding:"18px",background:"#171424d9"});
  const toolbar=document.createElement("div"); Object.assign(toolbar.style,{display:"flex",justifyContent:"flex-end",gap:"8px"});
  const download=document.createElement("a"); download.textContent="Télécharger le PDF"; download.href=url; download.download="fala-ai-cv-ats.pdf"; Object.assign(download.style,{padding:"10px 14px",borderRadius:"8px",background:"#8d78f2",color:"white",font:"700 12px system-ui",textDecoration:"none"});
  const close=document.createElement("button"); close.textContent="Fermer"; Object.assign(close.style,{padding:"10px 14px",border:0,borderRadius:"8px",background:"white",color:"#3b3450",font:"700 12px system-ui",cursor:"pointer"});
  const frame=document.createElement("iframe"); frame.src=url; frame.title="Aperçu PDF du CV adapté"; Object.assign(frame.style,{width:"min(900px,100%)",height:"calc(100dvh - 82px)",margin:"0 auto",border:0,borderRadius:"10px",background:"white"});
  close.onclick=()=>{overlay.remove();URL.revokeObjectURL(url);}; toolbar.append(download,close); overlay.append(toolbar,frame); document.body.append(overlay);
}
async function downloadDocx(text:string) {
  const xmlEscape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const paragraphs=text.split(/\r?\n/).map((line)=>`<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line||" ")}</w:t></w:r></w:p>`).join("");
  const zip=new JSZip();
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  downloadBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),"fala-ai-cv-ats.docx");
}
interface ReadCvOptions { onProgress?: (progress:number)=>void; }
function sanitizeExtractedCvText(value:string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/â(?:\u0080|€)?(?:\u0098|\u0099)/g, "'")
    .replace(/â(?:\u0080|€)?(?:\u0093|\u0094|\u0096|\u0097)/g, "-")
    .replace(/â€™|â€˜/g, "'").replace(/â€œ|â€/g, '"').replace(/â€“|â€”|â€\u0093|â€\u0094/g, "-")
    .replace(/dâ\s*experience/gi, "d'expérience")
    .replace(/(^|[\s([|])â(?=$|[\s)\].,;:!?])/g, "$1")
    .replace(/â(?=\s*(?:experience|expérience|ce|cette|les|le|la|un|une)\b)/gi, "'")
    // Certains PDF exportés depuis Word encodent les puces et séparateurs
    // comme des glyphes isolés (par ex. “, ‰). Les convertir ici évite qu'ils
    // se retrouvent au milieu des intitulés ou des coordonnées.
    .replace(/[“”]/g, "\n")
    .replace(/[‰]/g, " | ")
    // Les exports PDF utilisent souvent un glyphe de puce qui n'est pas
    // décodé par PDF.js. Il représente une nouvelle réalisation, pas un
    // espace : le convertir en saut de ligne évite de fusionner les postes.
    .replace(/[▪◼●➢✈•]/g, "\n")
    .replace(/\b([dls])\s{2,}(?=[a-zà-ÿ])/gi, "$1'")
    .replace(/\bC\s+ameroun\b/gi, "Cameroun")
    .replace(/\balt\s+ernant\b/gi, "alternant")
    .replace(/\bdecisi\s+on\b/gi, "decision")
    .replace(/\bpro\s+jets\b/gi, "projets")
    .replace(/\bIm\s+plementation\b/gi, "Implementation")
    .replace(/\bDeveloppe\s+ment\b/gi, "Developpement")
    .replace(/\bOptimisa\s+tion\b/gi, "Optimisation")
    // Recompose uniquement les mots coupés par un retour de ligne PDF ; les
    // vrais mots composés avec un espace autour du tiret restent inchangés.
    .replace(/([\p{L}]+)-[ \t]*\n[ \t]*([\p{Ll}]+)/gu, (_match,left,right)=>left.length>=6 && right.length<=3 ? `${left} ${right}` : `${left}${right}`)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !/^à$/.test(line) && !/^(?:[•▪◼●➢✈]|â€)[\s-]*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const CV_MAX_SIZE = 10 * 1024 * 1024;
const CV_MAX_TEXT = 120_000;
const CV_MAX_PAGES = 8;
const CV_READ_TIMEOUT = 60_000;

function hasBytes(bytes:Uint8Array, expected:number[], offset=0) { return expected.every((value,index)=>bytes[offset+index]===value); }
function hasPdfHeader(bytes:Uint8Array) {
  // A few export tools prepend a small binary preamble before %PDF. Accept
  // it while still requiring the genuine PDF signature near the beginning.
  const limit=Math.min(bytes.length-5,1024);
  for(let offset=0;offset<=limit;offset++) if(hasBytes(bytes,[0x25,0x50,0x44,0x46,0x2d],offset)) return true;
  return false;
}

async function readCvFile(file:File,options?:ReadCvOptions|((progress:number)=>void)) {
  const task=readCvFileInternal(file,options);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("La lecture du fichier dépasse le délai maximal de 60 secondes.")),CV_READ_TIMEOUT);});
  try {
    let localText=""; let localError:unknown=null;
    try { localText=await Promise.race([task,timeout]); } catch(error) { localError=error; }
    if(localText.trim().length>=80 || !file.name.toLowerCase().endsWith(".pdf")) {
      if(localError) throw localError;
      return localText;
    }
    const form=new FormData(); form.append("file",file,file.name);
    const response=await csrfFetch("/api/cv/extract",{method:"POST",body:form});
    const body=await response.json().catch(()=>({})) as {text?:string;error?:string};
    if(!response.ok || !body.text) {
      if(localError) throw localError;
      return localText;
    }
    return body.text;
  } finally { if(timer) clearTimeout(timer); }
}

async function readCvFileInternal(file:File,options?:ReadCvOptions|((progress:number)=>void)) {
  const onProgress=typeof options === "function" ? options : options?.onProgress;
  if(file.size>CV_MAX_SIZE) throw new Error("Le fichier dépasse la taille maximale autorisée (10 Mo).");
  onProgress?.(5);
  const filename=file.name.toLowerCase();
  const bytes=new Uint8Array(await file.arrayBuffer());
  const isPdf=hasPdfHeader(bytes);
  const isDocx=hasBytes(bytes,[0x50,0x4b,0x03,0x04]);
  const textExtension=/\.(txt|md|csv)$/i.test(filename);
  const declaredDocx=file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const declaredPdf=file.type === "application/pdf";
  if ((filename.endsWith(".pdf") || declaredPdf) && !isPdf) throw new Error("Le fichier ne correspond pas à un PDF valide.");
  if ((filename.endsWith(".docx") || declaredDocx) && !isDocx) throw new Error("Le fichier ne correspond pas à un DOCX valide.");
  if (!isPdf && !isDocx && !textExtension) throw new Error("Format non supporté. Utilisez un PDF, un DOCX ou un fichier texte.");
  if (filename.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const zip=await JSZip.loadAsync(bytes,{checkCRC32:false,createFolders:false});
    const entries=Object.values(zip.files);
    if(entries.length>2000) throw new Error("DOCX refusé : archive contenant trop d’éléments.");
    const uncompressedSize=entries.reduce((total,entry)=>total+Number((entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??0),0);
    if(uncompressedSize>50*1024*1024) throw new Error("DOCX refusé : taille décompressée excessive.");
    const documentFile=zip.file("word/document.xml");
    if (!documentFile) throw new Error("Le document DOCX ne contient pas de texte lisible.");
    const documentSize=Number((documentFile as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??0);
    if(documentSize>5*1024*1024) throw new Error("DOCX refusé : document XML trop volumineux.");
    const xml=await documentFile.async("text");
    if(xml.length>5*1024*1024) throw new Error("DOCX refusé : document XML trop volumineux.");
    const decodeXml=(value:string)=>value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(entity)=>{
      const key=entity.slice(1,-1).toLowerCase();
      if(key==="amp")return "&"; if(key==="lt")return "<"; if(key==="gt")return ">"; if(key==="quot")return '"'; if(key==="apos")return "'"; if(key==="nbsp")return " ";
      const code=key.startsWith("#x")?Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10); return Number.isFinite(code)?String.fromCodePoint(code):entity;
    });
    const paragraphs=[...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi)].map((match)=>{
      const body=match[1];
      const parts=[...body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map((item)=>decodeXml(item[1]));
      return parts.join("").replace(/\s+/g," ").trim();
    }).filter(Boolean);
    const text=sanitizeExtractedCvText(paragraphs.join("\n"));
    if(text.length>CV_MAX_TEXT) throw new Error("Le texte extrait du DOCX dépasse la limite autorisée.");
    onProgress?.(100); return text;
  }
  if (!isPdf) {
    if(bytes.subarray(0,4096).some((value)=>value===0)) throw new Error("Le fichier texte contient des données binaires non prises en charge.");
    const text=sanitizeExtractedCvText(new TextDecoder().decode(bytes));
    if(text.length>CV_MAX_TEXT) throw new Error("Le texte extrait dépasse la limite autorisée.");
    return text;
  }
  let text="";
  try {
    const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
    // PDF.js 6 peut échouer à charger son worker dans certains navigateurs
    // ou après le chargement depuis Vercel (URL de module différente selon le
    // bundler). Le traitement sans worker est volontaire ici : les CV sont
    // limités à 8 pages et cela garantit une lecture fiable sans dépendance
    // à un chemin d'asset ou à un CDN externe.
    const pdfOptions={data:bytes,useSystemFonts:true,disableWorker:true,isEvalSupported:false} as unknown as Parameters<typeof pdfjs.getDocument>[0];
    const document=await pdfjs.getDocument(pdfOptions).promise;
    if(document.numPages>CV_MAX_PAGES) throw new Error(`Le PDF dépasse la limite de ${CV_MAX_PAGES} pages.`);
    const pages:string[]=[];
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber); const content=await page.getTextContent();
      const items=(content.items as Array<{str?:string;transform?:number[];width?:number}>).filter((item)=>String(item.str??"").trim());
      const positioned=items.map((item)=>({x:Number(item.transform?.[4]??0),y:Number(item.transform?.[5]??0),width:Number(item.width??0),text:String(item.str??"").trim()}));
      // Détecter le séparateur réel par le plus grand espace entre deux
      // positions X. Le regroupement itératif par ancres mélangeait les
      // fragments lorsque chaque colonne avait des marges différentes.
      const starts=[...new Set(positioned.map((item)=>Math.round(item.x)).sort((a,b)=>a-b))];
      let splitX:number|null=null;
      let largestGap=0;
      for(let index=1;index<starts.length;index++){
        const gap=starts[index]-starts[index-1];
        if(gap>largestGap){largestGap=gap;splitX=(starts[index]+starts[index-1])/2;}
      }
      const twoColumns=splitX!==null && largestGap>=90 && (starts[starts.length-1]-starts[0])>=260;
      const columns=twoColumns
        ? [positioned.filter((item)=>item.x<splitX!),positioned.filter((item)=>item.x>=splitX!)]
        : [positioned];
      const columnText=columns.map((column)=>{
        const lines:Array<{y:number;items:Array<{x:number;text:string}>}>=[];
        for(const item of column.sort((a,b)=>b.y-a.y||a.x-b.x)){
          const current=lines.find((line)=>Math.abs(line.y-item.y)<=4);
          if(current) current.items.push(item);
          else lines.push({y:item.y,items:[item]});
        }
        return lines.sort((a,b)=>b.y-a.y).map((line)=>line.items.sort((a,b)=>a.x-b.x).map((item)=>item.text).join(" ")).join("\n");
      }).filter(Boolean);
      pages.push(columnText.join("\n\n"));
      onProgress?.(Math.round(10+(pageNumber/document.numPages)*85));
    }
    const rawPdfText=pages.join("\n");
    text=sanitizeExtractedCvText(rawPdfText);
    // Some PDFs use private glyphs or unusual line separators that the
    // cleanup pass can accidentally remove. Never turn a readable document
    // into a short CV just because normalization was too aggressive.
    if(text.trim().length<80 && rawPdfText.trim().length>text.trim().length) {
      text=rawPdfText.replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
    }
  } catch (error) {
    if(error instanceof Error && /dépasse la limite/.test(error.message)) throw error;
    const raw=new TextDecoder("latin1").decode(bytes);
    text=sanitizeExtractedCvText([...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match)=>match[1]).join(" ").replaceAll("\\n","\n").replaceAll("\\(","(").replaceAll("\\)",")"));
  }
  if (text.trim().length<40) {
    try {
      onProgress?.(15);
      const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
      const options={data:bytes,useSystemFonts:true,disableWorker:true,isEvalSupported:false} as unknown as Parameters<typeof pdfjs.getDocument>[0];
      const pdfDocument=await pdfjs.getDocument(options).promise;
      if(pdfDocument.numPages>CV_MAX_PAGES) throw new Error(`Le PDF dépasse la limite de ${CV_MAX_PAGES} pages.`);
      const { createWorker } = await import("tesseract.js");
      // Les chemins implicites de Tesseract changent selon le bundler et
      // provoquaient un `Failed to fetch` sur les PDF scannés en production.
      // Déclarer explicitement les ressources rend l'OCR reproductible sur Vercel.
      const ocrWorkerOptions = {
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
        logger: (message: { progress?: number }) => {
          if (typeof message.progress === "number") {
            onProgress?.(Math.round(20 + message.progress * 65));
          }
        },
      };
      let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
      const ocrPages:string[]=[];
      // OCR every page that passed the safety limit. Truncating at five pages
      // made otherwise valid multi-page CVs silently lose their later
      // experiences, education and certifications.
      const pageCount=pdfDocument.numPages;
      try {
        // Les CV sont majoritairement francophones ; l'anglais est un repli
        // pour les documents internationaux ou lorsque le pack français est
        // momentanément indisponible.
        try {
          worker = await createWorker("fra", 1, ocrWorkerOptions as never);
        } catch {
          worker = await createWorker("eng", 1, ocrWorkerOptions as never);
        }
        for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
          const page=await pdfDocument.getPage(pageNumber); const viewport=page.getViewport({scale:1.5});
          const canvas=document.createElement("canvas"); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
          await page.render({canvas,viewport}).promise;
          const result=await worker.recognize(canvas); ocrPages.push(result.data.text);
          onProgress?.(Math.round(20+(pageNumber/pageCount)*75));
        }
        text=sanitizeExtractedCvText(ocrPages.join("\n"));
      } finally {
        await worker?.terminate();
      }
    } catch (error) {
      if(error instanceof Error && /dépasse la limite/.test(error.message)) throw error;
      /* OCR is best-effort; the user receives a precise message below. */
    }
  }
  if (text.length>CV_MAX_TEXT) throw new Error("Le texte extrait du PDF dépasse la limite autorisée.");
  if (text.trim().length<40) throw new Error("Ce PDF ne contient pas assez de texte lisible, même après OCR. Essayez un PDF plus net ou un DOCX.");
  onProgress?.(100); return text;
}

export default function Home() {
  const [currentUser,setCurrentUser] = useState<{displayName:string;email:string}|null>(null);
  const [isAdmin,setIsAdmin] = useState(false);
  const [consentRequired,setConsentRequired] = useState(false);
  const [suspension,setSuspension] = useState<string|null>(null);
  const [authChecked,setAuthChecked] = useState(false);
  const [applications,setApplications] = useState<Application[]>([]);
  const [activity,setActivity] = useState<ActivityEvent[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("Toutes");
  const [view,setView] = useState<"list"|"kanban">("list");
  const [modal,setModalState] = useState<"choose"|"add"|"profile"|"privacy"|"report"|"import"|"notifications"|null>(null);
  const [parsedOffer,setParsedOffer] = useState<ParsedOffer|null>(null);
  const [offerText,setOfferText] = useState("");
  const [consentAccepted,setConsentAccepted] = useState(false);
  const [selected,setSelected] = useState<Application|null>(null);
  const [saving,setSaving] = useState(false);
  const [toast,setToast] = useState("");
  const [notificationsEnabled,setNotificationsEnabled] = useState(false);
  const [notificationReminders,setNotificationReminders] = useState<NotificationReminder[]>([]);
  const [sessions,setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoading,setSessionsLoading] = useState(false);
  const [sessionsBusy,setSessionsBusy] = useState(false);
  const [cvText,setCvText] = useState("");
  const [cvFileName,setCvFileName] = useState("");
  const [readingCv,setReadingCv] = useState(false);
  const [cvReadProgress,setCvReadProgress] = useState(0);
  const [adaptedCv,setAdaptedCv] = useState("");
  const [compatibility,setCompatibility] = useState<CompatibilityReport|null>(null);
  const [adaptingCv,setAdaptingCv] = useState(false);
  const [aiDisclosureAccepted,setAiDisclosureAccepted] = useState(false);
  const [interviewPrep,setInterviewPrepState] = useState<Application|null>(null);
  const [prepMode,setPrepMode] = useState<"guide"|"simulation">("guide");
  const [prepQuestionIndex,setPrepQuestionIndex] = useState(0);
  const [prepAnswer,setPrepAnswer] = useState("");
  const [prepFeedback,setPrepFeedback] = useState("");
  const [interviewChoiceOpen,setInterviewChoiceOpen] = useState(false);
  const [profileTitles,setProfileTitles] = useState<string[]>(["","",""]);
  const [profileContracts,setProfileContracts] = useState<string[]>([]);
  const [profileSectors,setProfileSectors] = useState<string[]>(["","","","",""]);
  const [profileLanguages,setProfileLanguages] = useState<string[]>([]);

  const notify = (message:string) => { setToast(message); window.setTimeout(()=>setToast(""),2600); };

  function resetOfferAnalysis() {
    setParsedOffer(null);
    setOfferText("");
    setCvText("");
    setCvFileName("");
    setReadingCv(false);
    setCvReadProgress(0);
    setAdaptedCv("");
    setCompatibility(null);
    setAdaptingCv(false);
    setAiDisclosureAccepted(false);
    setError("");
  }

  function setModal(next: "choose"|"add"|"profile"|"privacy"|"report"|"import"|"notifications"|null) {
    if (next === null && modal === "import") resetOfferAnalysis();
    setModalState(next);
  }

  function openOfferAnalysis() {
    resetOfferAnalysis();
    setModal("choose");
  }

  function closeOfferAnalysis() {
    resetOfferAnalysis();
    setModal(null);
  }

  function openInterviewPrep(application:Application) {
    setSelected(null);
    setInterviewPrepState(application); setPrepMode("guide"); setPrepQuestionIndex(0); setPrepAnswer(""); setPrepFeedback("");
  }
  function setInterviewPrep(application:Application|null) {
    if (application && !selected && interviewApplications.length > 1) { setInterviewChoiceOpen(true); return; }
    if (application) openInterviewPrep(application); else setInterviewPrepState(null);
  }

  function evaluateInterviewAnswer() {
    if (!interviewPrep) return;
    const answer = prepAnswer.trim();
    if (answer.length < 40) { setPrepFeedback("Réponse trop courte : visez 60 à 120 secondes. Ajoutez le contexte, votre action et le résultat obtenu."); return; }
    const normalized = answer.toLowerCase();
    const signals = {
      context: /situation|contexte|chez|lorsque|projet|équipe/.test(normalized),
      action: /j'ai|j’ai|nous avons|mis en place|conçu|analysé|piloté|décidé|résolu/.test(normalized),
      result: /résultat|impact|amélior|réduit|augment|livr|chiffre|%|€|jours|mois/.test(normalized),
      roleLink: new RegExp((interviewPrep.role || "poste").split(/\s+/).filter((word)=>word.length>3).slice(0,2).map((word)=>word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"i").test(answer),
    };
    const score = Object.values(signals).filter(Boolean).length;
    const missing = [!signals.context&&"un contexte précis",!signals.action&&"vos actions au ‘je’",!signals.result&&"un résultat ou un apprentissage",!signals.roleLink&&"le lien avec le poste"].filter(Boolean);
    setPrepFeedback(score >= 3
      ? `Bonne base (${score}/4) : votre réponse est structurée. À l’oral, annoncez d’abord l’idée principale, gardez les détails utiles et terminez par l’impact pour ${interviewPrep.company}.`
      : `À renforcer (${score}/4) : ajoutez ${missing.join(", ")}. Utilisez STAR pour une expérience et PREP pour une réponse courte, sans inventer de faits.`);
  }

  function nextInterviewQuestion() {
    if (!interviewPrep) return;
    const questions = interviewQuestions(interviewPrep);
    if (prepQuestionIndex >= questions.length - 1) { setInterviewPrepState(null); setPrepAnswer(""); setPrepFeedback(""); notify("Simulation terminée"); return; }
    setPrepQuestionIndex((current)=>current+1); setPrepAnswer(""); setPrepFeedback("");
  }

  function finishInterviewPrep() {
    setInterviewPrepState(null);
    setPrepAnswer("");
    setPrepFeedback("");
    notify("Simulation terminée");
  }

  const loadData = useCallback(async () => {
    setError("");
    try {
      const meResponse = await csrfFetch("/api/me",{cache:"no-store"});
      const meData = await meResponse.json();
      const tabSession = window.sessionStorage.getItem(TAB_SESSION_KEY);
      if (meData.user && !tabSession) {
        setCurrentUser(null); setIsAdmin(false); setAuthChecked(true); setLoading(false);
        window.location.replace("/auth?reauth=1");
        return;
      }
      setCurrentUser(meData.user ?? null); setIsAdmin(Boolean(meData.isAdmin)); setConsentRequired(Boolean(meData.consentRequired)); setSuspension(meData.suspended?String(meData.suspensionReason||"Compte suspendu"):null); setAuthChecked(true); setLoading(false);
      if (!meData.user) { window.sessionStorage.removeItem(TAB_SESSION_KEY); setApplications([]); setProfile(null); setActivity([]); return; }
      if (meData.suspended || meData.consentRequired) { setApplications([]); setProfile(null); setActivity([]); return; }
      const [appsResponse,profileResponse,activityResponse] = await Promise.all([csrfFetch("/api/applications",{cache:"no-store"}),csrfFetch("/api/profile",{cache:"no-store"}),csrfFetch("/api/activity",{cache:"no-store"})]);
      if (!appsResponse.ok || !profileResponse.ok || !activityResponse.ok) throw new Error(appsResponse.status===401?"Votre session a expiré. Reconnectez-vous.":"Impossible de charger vos données.");
      const appsData = await appsResponse.json(); const profileData = await profileResponse.json(); const activityData = await activityResponse.json();
      setApplications(appsData.applications ?? []); setProfile(profileData.profile ?? null); setActivity(activityData.activity ?? []);
    } catch (cause) { setError(cause instanceof Error?cause.message:"Erreur inattendue"); }
    finally { setLoading(false); }
  },[]);

  useEffect(()=>{ const timer=window.setTimeout(()=>void loadData(),0); return()=>window.clearTimeout(timer); },[loadData]);
  useEffect(()=>{ const link=document.querySelector<HTMLAnchorElement>('a[href="/api/account/export"]'); if(link){ link.textContent="Exporter mes candidatures (CSV Excel)"; let pdfLink=document.querySelector<HTMLAnchorElement>('a[data-export-pdf]'); if(!pdfLink){ pdfLink=document.createElement("a"); pdfLink.href="#"; pdfLink.download="fala-ai-candidatures.pdf"; pdfLink.dataset.exportPdf="true"; pdfLink.textContent="Télécharger mes candidatures (PDF)"; link.after(pdfLink); } pdfLink.onclick=(event)=>{ event.preventDefault(); downloadApplicationsPdf(applications); }; } },[modal,applications]);
  useEffect(()=>{
    const revalidateOnRestore = (event: PageTransitionEvent) => { if (event.persisted) void loadData(); };
    window.addEventListener("pageshow", revalidateOnRestore);
    window.addEventListener("popstate", revalidateOnRestore);
    return()=>{ window.removeEventListener("pageshow", revalidateOnRestore); window.removeEventListener("popstate", revalidateOnRestore); };
  },[loadData]);
  useEffect(()=>{ if (!currentUser) return; const timer=window.setTimeout(()=>void syncNotifications(true),0); const interval=window.setInterval(()=>void syncNotifications(true),60000); return()=>{window.clearTimeout(timer);window.clearInterval(interval);}; },[currentUser]);
  useEffect(()=>{ if (modal === "notifications" && currentUser) void syncNotifications(false); },[modal,currentUser]);
  useEffect(()=>{
    const attachSuggestions = (field:string,listId:string) => document.querySelectorAll<HTMLInputElement>(`input[name="${field}"]`).forEach((input)=>input.setAttribute("list",listId));
    const importDescription=document.querySelector<HTMLElement>('.modal[aria-labelledby="import-title"] > p');
    if(importDescription) importDescription.textContent="Ajoutez une candidature manuellement avec les informations de l’offre, ou collez/importez son texte pour extraire automatiquement les champs. Le CV est facultatif à cette étape.";
    attachSuggestions("location","fala-location-suggestions");
    attachSuggestions("sector","fala-sector-suggestions");
    attachSuggestions("sectors","fala-sector-suggestions");
    attachSuggestions("targetTitle","fala-role-suggestions");
    document.querySelectorAll<HTMLInputElement>('input[name="languages"]').forEach((input)=>input.setAttribute("list","fala-language-suggestions"));
    document.querySelectorAll<HTMLSelectElement>('.modal[aria-labelledby="profile-title"] select[name="contractType"]').forEach((select)=>{ select.multiple=true; select.size=3; const selectedValues=new Set(String(profile?.contract_type||"").split(/[,;]+/).map((item)=>item.trim()).filter(Boolean)); Array.from(select.options).forEach((option)=>{option.selected=selectedValues.has(option.value);}); });
    const addList = (id:string, values:string[]) => { if(document.getElementById(id)) return; const list=document.createElement("datalist"); list.id=id; values.forEach((value)=>{const option=document.createElement("option"); option.value=value; list.appendChild(option);}); document.body.appendChild(list); };
    addList("fala-role-suggestions",["Développeur","Développeur web","Data Analyst","Data Scientist","Business Analyst","Product Manager","Chef de projet","Consultant","Commercial","Chargé de communication","Ingénieur","Administrateur systèmes","Technicien support","Comptable","Contrôleur de gestion","Assistant administratif","Responsable RH","Juriste","Infirmier","Logisticien","Designer UX/UI"]);
    addList("fala-language-suggestions",languageSuggestions);
    addList("fala-contract-suggestions",contractSuggestions);
    const offerInput=document.querySelector<HTMLInputElement>('[aria-labelledby="import-title"] .file-picker input');
    if(!offerInput)return;
    offerInput.accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv";
    const handleOfferFile=async(event:Event)=>{
      event.stopImmediatePropagation();
      const file=(event.target as HTMLInputElement).files?.[0];
      if(!file)return;
      setSaving(true); setError("");
      try{
        const isText=/\.(txt|md|csv)$/i.test(file.name);
        const text=isText?sanitizeExtractedCvText(await file.text()):await readCvFile(file);
        setOfferText(text);
      }catch(cause){setError(cause instanceof Error?cause.message:"Lecture de l’annonce impossible");}
      finally{setSaving(false);}
    };
    offerInput.addEventListener("change",handleOfferFile);
    return()=>offerInput.removeEventListener("change",handleOfferFile);
  },[modal,profile]);
  useEffect(()=>{
    if(modal !== "profile") return;
    const split = (value:string|undefined) => String(value||"").split(/[,;\n]+/).map((item)=>item.trim()).filter(Boolean);
    setProfileTitles([...split(profile?.target_title).slice(0,3),"",""].slice(0,3));
    setProfileContracts(split(profile?.contract_type).slice(0,3));
    setProfileSectors([...split(profile?.sectors).slice(0,5),"","","","",""] .slice(0,5));
    setProfileLanguages(split(profile?.languages));
  },[modal,profile]);
  useEffect(()=>{ if (modal !== "privacy" || !currentUser) return; setSessionsLoading(true); void csrfFetch("/api/account/sessions",{cache:"no-store"}).then(async(response)=>{const body=await response.json().catch(()=>({}));if(response.ok)setSessions(body.sessions??[]);}).finally(()=>setSessionsLoading(false)); },[modal,currentUser]);

  async function syncNotifications(showBrowserAlerts = false) {
    const response = await csrfFetch("/api/notifications", { cache:"no-store" });
    if (!response.ok) return;
    const data = await response.json() as {enabled?:boolean; reminders?:NotificationReminder[]};
    setNotificationsEnabled(Boolean(data.enabled));
    const readStorageKey = `fala-read-notifications-${currentUser?.email ?? "user"}`;
    const readIds = new Set(readStoredIds(window.localStorage, readStorageKey));
    const next = (data.reminders ?? []).map((item)=>({ ...item, read: Boolean(item.read) || Boolean(item.notification_id && readIds.has(item.notification_id)) }));
    setNotificationReminders(next);
    if (!showBrowserAlerts || !data.enabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const storageKey = `fala-notified-${currentUser?.email ?? "user"}`;
    const already = new Set(readStoredIds(window.sessionStorage, storageKey));
    next.filter((item) => !item.read && new Date(item.date).getTime() <= Date.now() + 24 * 60 * 60 * 1000).forEach((item) => {
      const key = `${item.notification_id ?? item.id}-${item.type}-${item.date}`;
      if (already.has(key)) return;
      new Notification(`Fala AI · ${item.type}`, { body:`${item.role} chez ${item.company} — ${formatDate(item.date)}` });
      already.add(key);
    });
    writeStoredIds(window.sessionStorage, storageKey, [...already].slice(-50));
  }

  async function markNotificationRead(item:NotificationReminder) {
    if (item.read || !item.notification_id) return;
    setNotificationReminders((current)=>current.map((candidate)=>candidate.notification_id===item.notification_id?{...candidate,read:true}:candidate));
    const response = await csrfFetch("/api/notifications", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ action:"read", notificationId:item.notification_id }) });
    const result = await response.json().catch(()=>({read:false})) as {read?:boolean};
    if (result.read === true) {
      const key = `fala-read-notifications-${currentUser?.email ?? "user"}`;
      const ids = new Set(readStoredIds(window.localStorage, key));
      ids.add(item.notification_id);
      writeStoredIds(window.localStorage, key, [...ids]);
    }
    if (!response.ok || result.read !== true) {
      await syncNotifications(false);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { notify("Les notifications ne sont pas prises en charge par ce navigateur"); return; }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await csrfFetch("/api/notifications", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({enabled:true}) });
      setNotificationsEnabled(true);
      new Notification("Fala AI — rappels activés", { body: "Vous recevrez les échéances enregistrées dans vos candidatures." });
      notify("Notifications navigateur activées");
      await syncNotifications(true);
    } else {
      await csrfFetch("/api/notifications", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({enabled:false}) });
      setNotificationsEnabled(false); notify("Autorisation de notifications refusée");
    }
  }

  async function adaptCvToOffer() {
    if (!aiDisclosureAccepted) {
      const message="Cochez la case de consentement avant de lancer l’adaptation.";
      setError(message); notify(message);
      return;
    }
    if (offerText.trim().length < 40 || cvText.trim().length < 80) {
      const missing = [
        offerText.trim().length < 40 ? "une offre d’au moins 40 caractères" : "",
        cvText.trim().length < 80 ? "un CV lisible d’au moins 80 caractères" : "",
      ].filter(Boolean).join(" et ");
      const message=`Ajoutez ${missing} avant de lancer la restructuration.`;
      setError(message); notify(message);
      return;
    }
    setAdaptingCv(true); setError(""); setAdaptedCv(""); setCompatibility(null);
    try {
      const response = await csrfFetch("/api/cv/adapt", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ offer:offerText, cv:cvText }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { const message=body.error ?? "Adaptation du CV impossible"; setError(message); notify(message); return; }
      const result = String(body.adaptedCv ?? "").trim();
      if (!result) { setError("Aucun contenu n’a été généré. Vérifiez le texte de l’annonce et du CV."); return; }
      setAdaptedCv(result); notify(body.provider === "moteur local" ? "CV restructuré avec le moteur intégré" : "CV restructuré avec l’assistant IA");
      setCompatibility((body.compatibility as CompatibilityReport | undefined) ?? null);
    } catch { const message="Le service d’analyse est momentanément indisponible. Vérifiez votre connexion puis réessayez."; setError(message); notify(message); }
    finally { setAdaptingCv(false); }
  }

  const filtered = useMemo(()=>applications.filter((item)=>{
    const normalizedQuery = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const searchable = `${item.company} ${item.role} ${item.location} ${item.status} ${item.source} ${item.required_skills} ${item.notes}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
    return matchesQuery && (filter==="Toutes"||item.status===filter);
  }),[applications,query,filter]);

  const metrics = useMemo(()=>({
    active:applications.filter((a)=>!["Refusée","Archivée"].includes(a.status)).length,
    sent:applications.filter((a)=>["Envoyée","Entretien","Offre","Refusée"].includes(a.status)).length,
    interviews:applications.filter((a)=>a.status==="Entretien").length,
    offers:applications.filter((a)=>a.status==="Offre").length,
  }),[applications]);
  const responseRate = metrics.sent ? Math.round(applications.filter((a)=>["Entretien","Offre","Refusée"].includes(a.status)).length/metrics.sent*100) : 0;
  const interviewRate = metrics.sent ? Math.round(metrics.interviews/metrics.sent*100) : 0;
  const reminders = useMemo(()=>applications.flatMap((application)=>[{type:"Prochaine action",date:application.next_action_at,application},{type:"Entretien",date:application.interview_at,application}]).filter((item)=>item.date).sort((a,b)=>new Date(a.date!).getTime()-new Date(b.date!).getTime()).slice(0,20),[applications]);
  const notificationWindow = (date:string|null) => { if (!date) return false; const timestamp = new Date(date).getTime(); return Number.isFinite(timestamp) && timestamp >= Date.now() - 86400000 && timestamp <= Date.now() + 7 * 86400000; };
  const fallbackReminders = reminders.filter((item)=>notificationWindow(item.date)).map((item)=>({id:item.application.id,notification_id:`${item.application.id}:${item.type==="Entretien"?"interview":"next-action"}`,type:item.type,date:item.date!,company:item.application.company,role:item.application.role,status:item.application.status,read:false}));
  const unreadReminderCount = notificationReminders.filter((item)=>!item.read).length;
  const interviewTarget = useMemo(()=>selected?.status==="Entretien" ? selected : applications.find((application)=>application.status==="Entretien") ?? null,[applications,selected]);
  const interviewApplications = useMemo(()=>applications.filter((application)=>application.status==="Entretien"),[applications]);

  function launchInterviewCoach() {
    if (interviewApplications.length === 0) { notify("Ajoutez une candidature au statut Entretien"); return; }
    if (interviewApplications.length === 1) { setInterviewPrep(interviewApplications[0]); return; }
    setInterviewChoiceOpen(true);
  }

  async function acceptConsent(){setSaving(true);const response=await csrfFetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accepted:true})});setSaving(false);if(!response.ok){const body=await response.json();setError(body.error??"Consentement impossible");return;}setConsentRequired(false);void loadData();}

  async function analyzeOffer(){setSaving(true);setError("");const response=await csrfFetch("/api/offer/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:offerText})});const body=await response.json();setSaving(false);if(!response.ok){setError(body.error??"Analyse impossible");return;}setParsedOffer(body.parsed);setModal("add");notify("Annonce analysée — vérifiez les champs");}

  async function submitReport(form:FormData){setSaving(true);const response=await csrfFetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(form.entries()))});const body=await response.json();setSaving(false);if(!response.ok){setError(body.error??"Envoi impossible");return;}setModal(null);notify("Signalement transmis à l’administration");}

  async function deleteAccount(){const confirmation=window.prompt("Cette action est irréversible. Saisissez SUPPRIMER pour confirmer.");if(confirmation!=="SUPPRIMER")return;const response=await csrfFetch("/api/account",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation})});const body=await response.json();if(!response.ok){setError(body.error??"Suppression impossible");return;}window.location.href=body.signOut;}
  async function revokeAllSessions(){if(!window.confirm("Déconnecter tous les appareils ? Vous serez aussi déconnecté ici."))return;setSessionsBusy(true);const response=await csrfFetch("/api/account/sessions",{method:"DELETE"});const body=await response.json().catch(()=>({}));setSessionsBusy(false);if(!response.ok){setError(body.error??"Déconnexion impossible");return;}window.location.href="/auth?reauth=1";}

  async function addApplication(form:FormData) {
    setSaving(true); setError("");
    const payload = Object.fromEntries(form.entries());
    const response = await csrfFetch("/api/applications",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error??"Ajout impossible"); return; }
    setApplications((current)=>[data.application,...current]); setModal(null); notify("Candidature enregistrée durablement");
  }

  async function saveProfile(form:FormData) {
    setSaving(true); setError("");
    const payload = Object.fromEntries(form.entries());
    const capValues = (key:string, maximum:number) => form.getAll(key).map((item)=>String(item).trim()).filter(Boolean).filter((item,index,array)=>array.indexOf(item)===index).slice(0,maximum);
    payload.targetTitle = capValues("targetTitle",3).join(", ");
    payload.contractType = capValues("contractType",3).join(", ");
    payload.sectors = capValues("sectors",5).join(", ");
    payload.languages = capValues("languages",20).join(", ");
    const response = await csrfFetch("/api/profile",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    setSaving(false);
    if (!response.ok) { const data=await response.json(); setError(data.error??"Enregistrement impossible"); return; }
    setProfile({target_title:String(payload.targetTitle||""),location:String(payload.location||""),contract_type:String(payload.contractType||""),skills:String(payload.skills||""),experience_level:String(payload.experienceLevel||""),education_level:String(payload.educationLevel||""),languages:String(payload.languages||""),sectors:String(payload.sectors||""),salary_min:Number(payload.salaryMin||0)});
    const refreshed = await csrfFetch("/api/applications",{cache:"no-store"});
    if (refreshed.ok) { const body=await refreshed.json(); setApplications(body.applications??[]); }
    setModal(null); notify("Profil enregistré et scores recalculés");
  }

  async function updateApplication(form:FormData) {
    if (!selected) return;
    setSaving(true); const payload=Object.fromEntries(form.entries());
    const response=await csrfFetch(`/api/applications/${selected.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json(); setSaving(false);
    if(!response.ok){setError(data.error??"Mise à jour impossible");return;}
    setApplications((current)=>current.map((a)=>a.id===selected.id?data.application:a)); setSelected(null); notify("Candidature mise à jour");
  }

  async function removeApplication() {
    if(!selected||!window.confirm(`Supprimer définitivement la candidature ${selected.role} chez ${selected.company} ?`)) return;
    const response=await csrfFetch(`/api/applications/${selected.id}`,{method:"DELETE"});
    if(!response.ok){setError("Suppression impossible");return;}
    setApplications((current)=>current.filter((a)=>a.id!==selected.id)); setSelected(null); notify("Candidature supprimée");
  }

  if (!authChecked) return <main className="public-shell"><div className="public-loader"><span className="brand-mark">F</span><p>Ouverture de Fala AI…</p></div></main>;

  if (!currentUser) return <main className="public-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <header className="public-nav"><div className="brand"><span className="brand-mark">F</span><span>Fala <b>AI</b></span></div><div className="public-auth-links"><Link className="public-login" href="/auth">Connexion</Link><Link className="public-register" href="/auth?mode=register">Créer un compte</Link></div></header>
    <section className="public-hero"><div className="public-copy"><span className="public-kicker">SUIVI INTELLIGENT DES CANDIDATURES</span><h1>Votre recherche d’emploi.<br/><em>Enfin sous contrôle.</em></h1><p>Centralisez vos candidatures, calculez leur compatibilité et pilotez chaque prochaine action depuis un espace privé.</p><div className="public-actions"><Link className="public-cta" href="/auth?mode=register">Créer mon espace →</Link><span>Identité vérifiée · Données isolées · Historique conservé</span></div></div><div className="public-orbit" aria-hidden="true"><div className="public-core"><span>94</span><small>MATCH</small></div><i className="orbit-card one">Candidature</i><i className="orbit-card two">Entretien</i><i className="orbit-card three">Offre</i></div></section>
    <section className="public-features"><article><span>01</span><h2>Pipeline vivant</h2><p>Liste, Kanban, statuts et échéances restent synchronisés avec vos données.</p></article><article><span>02</span><h2>Scoring explicable</h2><p>Chaque score s’appuie sur vos compétences, votre expérience et vos préférences.</p></article><article><span>03</span><h2>Suivi personnel</h2><p>Vos candidatures appartiennent uniquement à votre compte authentifié.</p></article></section><footer className="public-footer"><Link href="/privacy">Confidentialité</Link><Link href="/terms">Conditions d’utilisation</Link></footer>
  </main>;

  if(suspension)return <main className="account-state"><span className="brand-mark">F</span><h1>Compte suspendu</h1><p>{suspension}</p><p>Vous pouvez demander un examen à l’administrateur : ibrahimapoukone@gmail.com.</p><a href="/api/auth/logout">Se déconnecter</a></main>;

  if(consentRequired)return <main className="consent-shell"><section className="consent-card"><span className="brand-mark">F</span><p className="eyebrow">PROTECTION DE VOS DONNÉES</p><h1>Bienvenue dans votre espace Fala AI</h1><p>Pour activer votre espace personnel, confirmez que vous avez lu la politique de confidentialité et les conditions d’utilisation. Vos candidatures restent privées et vous pourrez exporter ou supprimer vos données à tout moment.</p><label className="consent-check"><input type="checkbox" checked={consentAccepted} onChange={(event)=>setConsentAccepted(event.target.checked)}/>J’accepte le traitement de mes données pour fournir le service Fala AI.</label><div><a href="/privacy" target="_blank">Politique de confidentialité</a><a href="/terms" target="_blank">Conditions d’utilisation</a></div><button className="primary" disabled={!consentAccepted||saving} onClick={()=>void acceptConsent()}>{saving?"Activation…":"Activer mon espace"}</button><a href="/api/auth/logout">Refuser et se déconnecter</a></section></main>;

  if(modal==="choose") return <main className="app-shell"><div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div><div className="modal-backdrop"><section className="modal wide-modal add-choice-modal" role="dialog" aria-modal="true" aria-labelledby="add-choice-title"><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">＋</span><h2 id="add-choice-title">Ajouter une candidature</h2><p>Choisissez le parcours adapté à votre besoin.</p><div className="add-choice-grid"><button type="button" className="add-choice-card" onClick={()=>setModal("add")}><strong>Ajouter manuellement</strong><span>Renseignez l’entreprise, le poste, le statut, la localisation et les échéances. Aucun CV n’est nécessaire.</span><b>Remplir le formulaire →</b></button><button type="button" className="add-choice-card featured" onClick={()=>setModal("import")}><strong>Ajouter et analyser</strong><span>Collez ou importez le texte de l’offre : Fala AI extrait les informations et peut ensuite analyser votre CV.</span><b>Analyser une offre →</b></button></div></section></div></main>;

  return <main className="app-shell">
    <datalist id="fala-location-suggestions">{locationSuggestions.map((location)=><option key={location} value={location}/>)}</datalist>
    <datalist id="fala-sector-suggestions">{sectorSuggestions.map((sector)=><option key={sector} value={sector}/>)}</datalist>
    {interviewChoiceOpen&&<div className="modal-backdrop" onMouseDown={()=>setInterviewChoiceOpen(false)}><section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="interview-choice-title" onMouseDown={(event)=>event.stopPropagation()}><button className="modal-close" onClick={()=>setInterviewChoiceOpen(false)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="interview-choice-title">Quel entretien préparer ?</h2><p>Plusieurs candidatures sont au statut « Entretien ». Choisissez l’offre à travailler avec le coach.</p><div className="interview-choice-list">{interviewApplications.map((application)=><button type="button" className="interview-choice" key={application.id} onClick={()=>{setInterviewChoiceOpen(false);openInterviewPrep(application);}}><strong>{application.role}</strong><span>{application.company}{application.location?` · ${application.location}`:""}</span><small>{application.interview_at?formatDate(application.interview_at):"Entretien à préparer"}</small></button>)}</div></section></div>}
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F</span><span>Fala <b>AI</b></span></div>
      <nav aria-label="Navigation principale">
        <a className="nav-item active" href="#dashboard"><span className="icon">⌂</span>Vue d’ensemble</a>
        <a className="nav-item" href="#applications"><span className="icon">▱</span>Candidatures<span className="nav-badge">{applications.length}</span></a>
        <a className="nav-item" href="#analytics"><span className="icon">↗</span>Statistiques</a>
        {isAdmin&&<a className="nav-item admin-link" href="/admin"><span className="icon">◈</span>Administration</a>}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item sync-button" onClick={()=>void loadData()}><span className="icon">↻</span>Actualiser les données<span className="status-dot"/></button>
        <button className="nav-item sync-button" onClick={()=>setModal("profile")}><span className="icon">⚙</span>Profil de scoring</button>
        <button className="nav-item sync-button" onClick={()=>setModal("privacy")}><span className="icon">⌁</span>Mes données</button>
        <button className="nav-item sync-button" onClick={()=>setModal("report")}><span className="icon">!</span>Signaler un problème</button>
        <a className="nav-item" href="/api/auth/logout"><span className="icon">↪</span>Se déconnecter</a>
      </div>
    </aside>

    <section className="content" id="dashboard">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">F</span> Fala AI</div>
        <label className="search"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Rechercher dans vos candidatures…"/></label>
        <div className="top-actions"><span className="live"><i/>{currentUser.displayName}</span><button className="notification-button" onClick={()=>setModal("notifications")} aria-label={`${unreadReminderCount} rappels non lus`}>♢{unreadReminderCount>0&&<span className="notification-dot" aria-hidden="true"/>}</button><button className="primary" onClick={openOfferAnalysis}>＋ Ajouter</button><details className="mobile-menu"><summary aria-label="Ouvrir le menu">•••</summary><div><a href="#dashboard">Vue d’ensemble</a><a href="#applications">Candidatures</a><a href="#analytics">Statistiques</a><button onClick={()=>setModal("profile")}>Profil de scoring</button><button onClick={()=>setModal("privacy")}>Mes données</button><button onClick={()=>setModal("report")}>Signaler un problème</button>{isAdmin&&<a href="/admin">Administration</a>}<a href="/api/auth/logout">Se déconnecter</a></div></details></div>
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
        <section className="interview-hub" id="interview-prep"><div className="section-title"><div><span className="focus-label">COACHING FALA AI</span><h2>Préparer vos entretiens</h2><p>Une méthode simple pour arriver prêt, répondre clairement et relancer au bon moment.</p></div>{interviewTarget&&<button className="primary" onClick={()=>setInterviewPrep(interviewTarget)}>Lancer une simulation →</button>}</div><div className="interview-grid"><article><span>01 · AVANT</span><h3>Préparer le fond</h3><p>Relisez l’offre, sélectionnez trois réalisations chiffrées et préparez une présentation de 60 secondes.</p><ul><li>Situation → action → résultat</li><li>Deux questions sur le poste</li><li>Une relance prête à envoyer</li></ul></article><article><span>02 · PENDANT</span><h3>Répondre avec impact</h3><p>Commencez par l’idée principale, donnez un exemple concret, puis reliez-le au besoin de l’entreprise.</p><ul><li>« Voici ce que j’ai réalisé… »</li><li>« L’impact mesurable a été… »</li><li>« Ce que je reproduirais ici… »</li></ul></article><article><span>03 · APRÈS</span><h3>Transformer l’échange</h3><p>Notez les attentes, envoyez un message de remerciement et planifiez une relance liée à une date précise.</p><ul><li>Remerciement personnalisé</li><li>Rappel d’un point clé</li><li>Prochaine étape demandée</li></ul></article></div><div className="interview-bottom"><div><strong>Expressions clés</strong><p>{profile?.sectors?.toLowerCase().includes("finance")||interviewTarget?.role.toLowerCase().includes("finance")?"Marge, prévision, contrôle, indicateurs, fiabilité des données, aide à la décision.":interviewTarget?.role.toLowerCase().includes("tech")||interviewTarget?.role.toLowerCase().includes("data")?"Qualité, automatisation, mise à l’échelle, impact utilisateur, documentation.":"Résultat, collaboration, priorisation, amélioration continue, satisfaction client."}</p></div><button className="ghost-button" onClick={()=>interviewTarget?setInterviewPrep(interviewTarget):notify("Ajoutez d’abord une candidature")}>S’entraîner aux questions types</button></div></section>
        <footer><span>Fala AI · Accès privé et données isolées par utilisateur</span><span><i/> Stockage persistant actif</span></footer>
      </div>
    </section>

    {modal==="profile"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="profile-title">Profil de scoring</h2><p>Choisissez jusqu’à 3 postes, 3 contrats et autant de langues que nécessaire. Les postes peuvent être choisis dans la liste ou saisis librement.</p><form action={saveProfile}><div className="form-grid"><div className="profile-list-field span-2"><strong>Postes recherchés <small>(maximum 3)</small></strong>{profileTitles.map((title,index)=><div className="profile-list-row" key={`title-${index}`}><input name="targetTitle" value={title} list="fala-role-suggestions" onChange={(event)=>setProfileTitles((current)=>current.map((item,itemIndex)=>itemIndex===index?event.target.value:item))} placeholder={index===0?"Choisir ou saisir un poste":"Ajouter un autre poste"} required={index===0}/>{index>0&&<button type="button" className="remove-chip" aria-label={`Retirer le poste ${index+1}`} onClick={()=>setProfileTitles((current)=>current.map((item,itemIndex)=>itemIndex===index?"":item))}>×</button>}</div>)}</div><label>Localisation cible<input name="location" defaultValue={profile?.location||""} required/></label><div className="profile-list-field"><strong>Types de contrat <small>(maximum 3)</small></strong><select name="contractType" multiple required size={Math.min(6,contractSuggestions.length)} value={profileContracts} onChange={(event)=>setProfileContracts(Array.from(event.target.selectedOptions).map((option)=>option.value).slice(0,3))}>{contractSuggestions.map((contract)=><option key={contract} value={contract}>{contract}</option>)}</select><small>Choisissez jusqu’à 3 options (Ctrl/Cmd pour plusieurs).</small></div><label>Expérience<select name="experienceLevel" defaultValue={profile?.experience_level||""}><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationLevel" defaultValue={profile?.education_level||""}><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0" defaultValue={profile?.salary_min||0}/></label><label className="span-2">Compétences<input name="skills" defaultValue={profile?.skills||""} placeholder="Python, SQL, Power BI" required/></label><div className="profile-list-field span-2"><strong>Langues maîtrisées <small>(sélection multiple)</small></strong><select name="languages" multiple size={Math.min(8,languageSuggestions.length)} value={profileLanguages} onChange={(event)=>setProfileLanguages(Array.from(event.target.selectedOptions).map((option)=>option.value))}>{languageSuggestions.map((language)=><option key={language} value={language}>{language}</option>)}</select><small>Choisissez toutes les langues que vous maîtrisez (Ctrl/Cmd pour plusieurs).</small></div><div className="profile-list-field span-2"><strong>Secteurs recherchés <small>(maximum 5)</small></strong>{profileSectors.map((sector,index)=><div className="profile-list-row" key={`sector-${index}`}><input name="sectors" value={sector} list="fala-sector-suggestions" onChange={(event)=>setProfileSectors((current)=>current.map((item,itemIndex)=>itemIndex===index?event.target.value:item))} placeholder={index===0?"Ex. Finance":"Ajouter un secteur"}/>{index>0&&<button type="button" className="remove-chip" aria-label={`Retirer le secteur ${index+1}`} onClick={()=>setProfileSectors((current)=>current.map((item,itemIndex)=>itemIndex===index?"":item))}>×</button>}</div>)}</div></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer et recalculer"}</button></div></form></div></div>}

    {modal==="add"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">＋</span><h2 id="add-title">Ajouter une candidature</h2><p>Les champs extraits restent modifiables avant enregistrement. Aucune information manquante n’est inventée.</p><form key={JSON.stringify(parsedOffer)} action={addApplication}><div className="form-grid"><label>Entreprise<input name="company" defaultValue={parsedOffer?.company||""} required autoFocus/></label><label>Poste<input name="role" defaultValue={parsedOffer?.role||""} required/></label><label>Localisation<input name="location" defaultValue={parsedOffer?.location||""}/></label><label>Type de contrat<select name="contractType" defaultValue={parsedOffer?.contractType||""}><option value="">Non précisé</option><option>CDI</option><option>CDD</option><option>Alternance</option><option>Stage</option><option>Freelance</option></select></label><label>Source<input name="source" defaultValue={parsedOffer?.source||""} placeholder="LinkedIn, France Travail…"/></label><label>Statut<select name="status" defaultValue="À préparer">{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label className="span-2">Compétences demandées<input name="requiredSkills" defaultValue={parsedOffer?.requiredSkills||""} placeholder="Python, SQL, dbt"/></label><label>Expérience demandée<select name="experienceRequired" defaultValue={parsedOffer?.experienceRequired||""}><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationRequired" defaultValue={parsedOffer?.educationRequired||""}><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Langues<input name="languages" defaultValue={parsedOffer?.languages||""}/></label><label>Secteur<input name="sector" defaultValue={parsedOffer?.sector||""}/></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0" defaultValue={parsedOffer?.salaryMin||0}/></label><label>Date de candidature<input name="appliedAt" type="date"/></label><label>Prochaine action<input name="nextActionAt" type="datetime-local"/></label><label>Entretien<input name="interviewAt" type="datetime-local"/></label><label className="span-2">Notes<textarea name="notes" rows={3} defaultValue={parsedOffer?.notes||""}/></label></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer durablement"}</button></div></form></div></div>}

    {modal==="import"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">⌁</span><h2 id="import-title">Analyser une offre et préparer votre CV</h2><p>Collez l’annonce pour extraire les critères, puis ajoutez votre CV. Le résultat reste fondé uniquement sur votre contenu et est structuré pour une lecture ATS.</p><label className="file-picker">Importer l’annonce (PDF, DOCX ou texte)<input type="file" accept=".txt,.md,.csv,text/plain,text/csv" onChange={async(event)=>{const file=event.target.files?.[0];if(file)setOfferText(await file.text());}}/></label><label>Texte de l’annonce<textarea rows={8} value={offerText} onChange={(event)=>setOfferText(event.target.value)} placeholder="Collez ici le contenu de l’annonce…"/></label><div className="modal-actions"><button type="button" onClick={()=>{setParsedOffer(null);setModal("add");}}>Saisie manuelle</button><button className="primary" disabled={saving||offerText.trim().length<30} onClick={()=>void analyzeOffer()}>{saving?"Analyse…":"Extraire les informations"}</button></div><hr/><label className="file-picker">Importer votre CV (PDF, DOCX ou texte)<input type="file" accept=".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={async(event)=>{const file=event.target.files?.[0];if(!file)return;setCvFileName(file.name);setAdaptedCv("");setCompatibility(null);setReadingCv(true);setCvReadProgress(5);try{setCvText(await readCvFile(file,(value)=>setCvReadProgress(value)));setError("");}catch(cause){setError(cause instanceof Error?cause.message:"Lecture du CV impossible");}finally{setReadingCv(false);}}}/></label>{readingCv&&<div className="cv-progress" role="status"><span className="loading-ring"/><div><strong>Lecture du CV en cours… {cvReadProgress}%</strong><div className="progress-track"><i style={{width:`${cvReadProgress}%`}}/></div></div></div>}<div className="cv-file-status"><strong>{cvFileName ? `Fichier sélectionné : ${cvFileName}` : "Aucun fichier sélectionné"}</strong><span>Le texte sera extrait automatiquement pour l’analyse.</span></div><small className="input-hint">Offre : {offerText.trim().length} caractères · CV extrait : {cvText.trim().length} caractères</small><div className="ai-processing-notice"><strong>Traitement par IA externe</strong><p>Lors de l’adaptation, le texte de l’offre et du CV peut être transmis à Groq (ou rester dans le moteur local si Groq est indisponible). Fala AI ne conserve pas ces textes bruts dans votre compte. Groq peut traiter les données hors de l’Espace économique européen selon sa configuration ; consultez la <a href="/privacy" target="_blank">politique de confidentialité</a>.</p><label className="auth-consent"><input type="checkbox" checked={aiDisclosureAccepted} onChange={(event)=>setAiDisclosureAccepted(event.target.checked)} />J’ai compris et j’autorise ce traitement pour cette analyse.</label></div><button className="primary" disabled={readingCv||adaptingCv} onClick={()=>void adaptCvToOffer()}>{readingCv?"Lecture du CV…":adaptingCv?"Préparation…":"Adapter mon CV aux critères ATS"}</button>{adaptedCv&&<div className="analysis-results-grid"><label className="cv-result">CV adapté — vérifiez chaque information avant envoi<textarea rows={14} value={adaptedCv} onChange={(event)=>setAdaptedCv(event.target.value)} /><span className="download-actions"><button type="button" className="ghost-button" onClick={()=>void navigator.clipboard?.writeText(adaptedCv)}>Copier</button><button type="button" className="ghost-button" onClick={()=>downloadPdf(adaptedCv)}>Télécharger PDF</button><button type="button" className="ghost-button" onClick={()=>void downloadDocx(adaptedCv)}>Télécharger DOCX</button></span></label>{compatibility&&<aside className="compatibility-card" aria-label="Score de compatibilité"><div className="compatibility-head"><div><span className="focus-label">COMPATIBILITÉ OFFRE / CV</span><h3>{compatibility.recommendation}</h3></div><strong>{compatibility.percentage}<small>%</small></strong></div><div className="compatibility-meter"><i style={{width:`${compatibility.percentage}%`}}/></div><div className="compatibility-columns"><div><b>Correspondances</b>{compatibility.matchingSkills.length?<ul>{compatibility.matchingSkills.slice(0,5).map((item)=><li key={item}>✓ {item}</li>)}</ul>:<p>Aucune compétence clé confirmée.</p>}</div><div><b>À vérifier</b>{compatibility.gaps.length?<ul>{compatibility.gaps.map((item)=><li key={item}>• {item}</li>)}</ul>:<p>Aucun écart majeur détecté.</p>}</div></div><small className="compatibility-note">Score indicatif calculé à partir du CV fourni et des critères extraits de l’offre. Vérifiez chaque information.</small></aside>}</div>}</div></div>}

    {modal==="privacy"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal data-modal" role="dialog" aria-modal="true" aria-labelledby="data-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">⌁</span><h2 id="data-title">Mes données</h2><p>Vous gardez le contrôle sur les informations associées à votre compte.</p><div className="data-actions"><a href="/api/account/export" download>Exporter toutes mes données (JSON)</a><a href="/privacy" target="_blank">Lire la politique de confidentialité</a><a href="/terms" target="_blank">Lire les conditions d’utilisation</a><button className="session-revoke" onClick={()=>void revokeAllSessions()} disabled={sessionsBusy}>{sessionsBusy?"Déconnexion…":"Déconnecter tous les appareils"}</button><button className="danger-button" onClick={()=>void deleteAccount()}>Supprimer mon compte et tout l’historique</button></div><section className="sessions-panel" aria-labelledby="sessions-title"><div className="sessions-heading"><div><h3 id="sessions-title">Sessions actives</h3><p>Les sessions inactives depuis 30 jours expirent automatiquement.</p></div><span>{sessions.length}</span></div>{sessionsLoading?<p className="sessions-empty">Chargement des sessions…</p>:sessions.length===0?<p className="sessions-empty">Aucune autre session active.</p>:<div className="session-list">{sessions.map((session)=><div className="session-row" key={`${session.createdAt}-${session.lastSeenAt}`}><span className="session-device">{session.device}{session.current&&<b>Session actuelle</b>}</span><span>Dernière activité : {formatDate(session.lastSeenAt)}</span><small>Expire : {formatDate(session.expiresAt)}</small></div>)}</div>}</section></div></div>}

    {modal==="report"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">!</span><h2 id="report-title">Signaler un problème</h2><p>Votre signalement sera visible dans le centre de contrôle administrateur.</p><form action={submitReport}><label>Catégorie<select name="category"><option>Problème technique</option><option>Données personnelles</option><option>Abus</option><option>Suggestion</option></select></label><label>Description<textarea name="message" rows={6} minLength={10} required/></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Envoi…":"Envoyer"}</button></div></form></div></div>}

    {modal==="notifications"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal reminders-modal" role="dialog" aria-modal="true" aria-labelledby="reminders-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">♢</span><h2 id="reminders-title">Rappels et échéances</h2><p>Fala AI vérifie vos prochaines actions et entretiens. Une notification est affichée sur cet appareil dans les 24 heures avant l’échéance lorsque vous avez donné votre accord.</p><button className="primary notification-enable" onClick={()=>void enableNotifications()} disabled={notificationsEnabled}>{notificationsEnabled?"✓ Notifications activées":"Activer les notifications"}</button><div className="reminder-list">{(notificationReminders.length?notificationReminders:fallbackReminders).map((item,index)=><button key={`${item.notification_id??item.type}-${item.date}-${index}`} className={item.read?"is-read":"is-unread"} onClick={async()=>{await markNotificationRead(item);const application=applications.find((candidate)=>candidate.id===item.id);if(application)setSelected(application);setModal(null);}}><span>{item.type}{item.read?" · Lu":" · Nouveau"}</span><strong>{item.role} · {item.company}</strong><time>{formatDate(item.date)}</time></button>)}{!(notificationReminders.length||fallbackReminders.length)&&<p>Aucune échéance programmée.</p>}</div></div></div>}

    {interviewPrep&&<div className="modal-backdrop" onMouseDown={()=>setInterviewPrep(null)}><div className="modal wide-modal interview-modal" role="dialog" aria-modal="true" aria-labelledby="prep-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setInterviewPrep(null)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="prep-title">Préparer votre entretien</h2><p>{interviewPrep.role} · {interviewPrep.company}</p><div className="prep-tabs"><button className={prepMode==="guide"?"active":""} onClick={()=>setPrepMode("guide")}>Guide express</button><button className={prepMode==="simulation"?"active":""} onClick={()=>setPrepMode("simulation")}>Simulation interactive</button></div>{prepMode==="guide"?<><div className="prep-list"><article><strong>1. Votre présentation</strong><p>Préparez une réponse de 60 à 90 secondes : parcours, expertise principale et lien avec ce poste.</p></article><article><strong>2. Trois exemples concrets</strong><p>Utilisez la méthode STAR (situation, tâche, action, résultat) pour illustrer les compétences demandées.</p></article><article><strong>3. Questions à poser</strong><p>Demandez les priorités des 90 premiers jours, les critères de réussite et les prochaines étapes.</p></article><article><strong>4. Dernière vérification</strong><p>Relisez l’annonce, préparez deux réalisations chiffrées et planifiez votre relance.</p></article></div><div className="modal-actions"><button className="primary" onClick={()=>setPrepMode("simulation")}>Commencer la simulation →</button></div></>:<><div className="simulation-progress"><span>QUESTION {prepQuestionIndex+1}/{interviewQuestions(interviewPrep).length}</span><div><i style={{width:`${((prepQuestionIndex+1)/interviewQuestions(interviewPrep).length)*100}%`}}/></div></div><article className="simulation-card"><span className="focus-label">{interviewQuestions(interviewPrep)[prepQuestionIndex].label}</span><h3>{interviewQuestions(interviewPrep)[prepQuestionIndex].prompt}</h3><p>{interviewQuestions(interviewPrep)[prepQuestionIndex].hint}</p><textarea rows={6} value={prepAnswer} onChange={(event)=>setPrepAnswer(event.target.value)} placeholder="Écrivez votre réponse comme si vous étiez face au recruteur…"/><small>{prepAnswer.trim().length} caractères · visez une réponse concrète</small></article>{prepFeedback&&<div className="prep-feedback" role="status"><strong>Feedback Fala AI</strong><p>{prepFeedback}</p></div>}<div className="modal-actions"><button type="button" onClick={evaluateInterviewAnswer} disabled={!prepAnswer.trim()}>Analyser ma réponse</button><button type="button" className="primary" onClick={nextInterviewQuestion}>{prepQuestionIndex===interviewQuestions(interviewPrep).length-1?"Terminer":"Question suivante →"}</button></div></>}</div></div>}

    {selected&&<div className="modal-backdrop" onMouseDown={()=>setSelected(null)}><div className="modal score-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSelected(null)} aria-label="Fermer">×</button>{selected.status==="Entretien"&&<button className="ghost-button interview-prep-trigger" onClick={()=>setInterviewPrep(selected)}>Préparer cet entretien →</button>}<div className="score-summary"><span className="score huge">{selected.score??"—"}<small>/100</small></span><div><span className="focus-label">{scoreLabel(selected.score)}</span><h2 id="detail-title">{selected.role}</h2><p>{selected.company} · {selected.location||"Localisation non précisée"}</p></div></div>{parseScoreBreakdown(selected.score_breakdown)&&<div className="score-bars">{Object.entries(parseScoreBreakdown(selected.score_breakdown)??{}).map(([label,value])=><div key={label}><div><span>{scoreNames[label]??label}</span><b>{value} / {scoreMaximums[label]??10}</b></div><progress value={value} max={scoreMaximums[label]??10}/></div>)}</div>}<form action={updateApplication}><div className="form-grid"><label>Statut<select name="status" defaultValue={selected.status}>{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label>Prochaine action<input name="nextActionAt" type="datetime-local" defaultValue={selected.next_action_at?.slice(0,16)||""}/></label><label>Entretien<input name="interviewAt" type="datetime-local" defaultValue={selected.interview_at?.slice(0,16)||""}/></label><label className="span-2">Notes<textarea name="notes" rows={4} defaultValue={selected.notes}/></label></div><div className="modal-actions split-actions"><button type="button" className="danger-button" onClick={()=>void removeApplication()}>Supprimer</button><span/><button type="button" onClick={()=>setSelected(null)}>Fermer</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button></div></form></div></div>}
    {toast&&<div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}
