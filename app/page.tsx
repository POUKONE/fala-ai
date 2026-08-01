"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";

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
type NotificationReminder = {id:number;type:string;date:string;company:string;role:string;status:string};

const statuses = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
const educationLevels = ["Bac","Bac+1","Bac+2","Bac+3","Bac+4","Bac+5","Bac+6","Bac+7","Bac+8 et plus"];
const scoreMaximums:Record<string,number> = {skills:35,title:15,experience:15,location:10,education:10,contract:5,languages:5,salary:5};
const scoreNames:Record<string,string> = {skills:"Compétences",title:"Intitulé du poste",experience:"Expérience",education:"Études",location:"Localisation",contract:"Contrat",languages:"Langues",sector:"Secteur",salary:"Salaire"};

function parseScoreBreakdown(value:unknown):Record<string,number>|null {
  if (!value) return null;
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return Object.fromEntries(Object.entries(parsed).flatMap(([key,item]) => {
    if(typeof item === "number") return [[key,item]];
    if(item && typeof item === "object" && !Array.isArray(item) && typeof (item as {weightedScore?:unknown}).weightedScore === "number") return [[key,(item as {weightedScore:number}).weightedScore]];
    return [];
  })) as Record<string,number>;
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

type InterviewQuestion = { label:string; prompt:string; hint:string };
function interviewQuestions(application:Application):InterviewQuestion[] {
  const role = application.role || "ce poste";
  const skills = application.required_skills ? application.required_skills.split(/[,;\n]+/).map((item)=>item.trim()).filter(Boolean).slice(0,3).join(", ") : "vos compétences clés";
  return [
    {label:"Présentation",prompt:`Présentez-vous en 60 secondes et expliquez pourquoi votre parcours correspond au poste de ${role}.`,hint:"Structurez votre réponse : parcours → expertise → lien avec le poste."},
    {label:"Motivation",prompt:`Pourquoi souhaitez-vous rejoindre ${application.company} sur ce poste ?`,hint:"Citez un élément précis de l’entreprise ou de l’offre, puis reliez-le à votre objectif."},
    {label:"Compétences",prompt:`Donnez un exemple concret où vous avez utilisé ${skills}.`,hint:"Utilisez STAR : situation, tâche, action, résultat. Ajoutez un chiffre si possible."},
    {label:"Situation",prompt:"Parlez d’une difficulté professionnelle que vous avez résolue et de ce que vous en avez appris.",hint:"Restez factuel, expliquez votre décision et terminez par l’impact obtenu."},
  ];
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
function downloadPdf(text:string) { previewPdf(text); }
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
    .replace(/â€™|â€˜/g, "'").replace(/â€œ|â€/g, '"').replace(/â€“|â€”|â€\u0093|â€\u0094/g, "-")
    .replace(/dâ\s*experience/gi, "d'expérience")
    // Certains PDF exportés depuis Word encodent les puces et séparateurs
    // comme des glyphes isolés (par ex. “, ‰). Les convertir ici évite qu'ils
    // se retrouvent au milieu des intitulés ou des coordonnées.
    .replace(/[“”]/g, "\n")
    .replace(/[‰]/g, " | ")
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
    .replace(/[\u{1F300}-\u{1FAFF}▪◼●➢✈]/gu, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !/^à$/.test(line) && !/^(?:[•▪◼●➢✈]|â€)[\s-]*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
async function readCvFile(file:File,options?:ReadCvOptions|((progress:number)=>void)) {
  const onProgress=typeof options === "function" ? options : options?.onProgress;
  const maxSizeMb=10;
  if(file.size>maxSizeMb*1024*1024) throw new Error(`Le fichier dépasse la taille maximale autorisée (${maxSizeMb} Mo).`);
  onProgress?.(5);
  const filename=file.name.toLowerCase();
  if (filename.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const zip=await JSZip.loadAsync(await file.arrayBuffer()); const documentFile=zip.file("word/document.xml");
    if (!documentFile) throw new Error("Le document DOCX ne contient pas de texte lisible.");
    const xml=await documentFile.async("text");
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
    onProgress?.(100); return text;
  }
  if (!filename.endsWith(".pdf") && file.type !== "application/pdf") return sanitizeExtractedCvText(await file.text());
  let text="";
  try {
    const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Utiliser le worker livré avec l'application : le CDN public peut être
    // bloqué par le navigateur et laisser l'extraction à zéro caractère.
    if(!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
    const pdfOptions={data:await file.arrayBuffer(),useSystemFonts:true} as unknown as Parameters<typeof pdfjs.getDocument>[0];
    const document=await pdfjs.getDocument(pdfOptions).promise;
    const pages:string[]=[];
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber); const content=await page.getTextContent();
      const items=(content.items as Array<{str?:string;transform?:number[]}>).filter((item)=>String(item.str??"").trim());
      const positioned=items.map((item)=>({x:Number(item.transform?.[4]??0),y:Math.round(Number(item.transform?.[5]??0)/2)*2,text:String(item.str??"").trim()}));
      // Group distant horizontal starts into columns. Joining every item by Y
      // makes a two-column CV read as alternating experience/skills fragments.
      const starts=[...new Set(positioned.map((item)=>item.x).sort((a,b)=>a-b))];
      let anchors=[starts[0]];
      if(starts.length>2 && starts[starts.length-1]-starts[0]>180){
        let left=starts[0],right=starts[starts.length-1];
        for(let iteration=0;iteration<4;iteration++){
          const leftItems=positioned.filter((item)=>Math.abs(item.x-left)<=Math.abs(item.x-right));
          const rightItems=positioned.filter((item)=>Math.abs(item.x-left)>Math.abs(item.x-right));
          left=leftItems.reduce((sum,item)=>sum+item.x,0)/Math.max(1,leftItems.length);
          right=rightItems.reduce((sum,item)=>sum+item.x,0)/Math.max(1,rightItems.length);
        }
        anchors=[Math.min(left,right),Math.max(left,right)];
      }
      const columns=anchors.map((anchor,index)=>positioned.filter((item)=>{
        const distances=anchors.map((candidate)=>Math.abs(item.x-candidate));
        return distances.indexOf(Math.min(...distances))===index;
      }));
      const columnText=columns.map((column)=>{
        const lines=new Map<number,Array<{x:number;text:string}>>();
        for(const item of column){const current=lines.get(item.y)??[];current.push(item);lines.set(item.y,current);}
        return [...lines.entries()].sort((a,b)=>b[0]-a[0]).map(([,line])=>line.sort((a,b)=>a.x-b.x).map((item)=>item.text).join(" ")).join("\n");
      }).filter(Boolean);
      pages.push(columnText.join("\n\n"));
      onProgress?.(Math.round(10+(pageNumber/document.numPages)*85));
    }
    text=sanitizeExtractedCvText(pages.join("\n"));
  } catch {
    const raw=new TextDecoder("latin1").decode(await file.arrayBuffer());
    text=sanitizeExtractedCvText([...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match)=>match[1]).join(" ").replaceAll("\\n","\n").replaceAll("\\(","(").replaceAll("\\)",")"));
  }
  if (text.trim().length<40) {
    try {
      onProgress?.(15);
      const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
      const options={data:await file.arrayBuffer(),useSystemFonts:true} as unknown as Parameters<typeof pdfjs.getDocument>[0];
      const pdfDocument=await pdfjs.getDocument(options).promise;
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
      const pageCount=Math.min(pdfDocument.numPages, 5);
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
    } catch { /* OCR is best-effort; the user receives a precise message below. */ }
  }
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
  const [modal,setModal] = useState<"add"|"profile"|"privacy"|"report"|"import"|"notifications"|null>(null);
  const [parsedOffer,setParsedOffer] = useState<ParsedOffer|null>(null);
  const [offerText,setOfferText] = useState("");
  const [consentAccepted,setConsentAccepted] = useState(false);
  const [selected,setSelected] = useState<Application|null>(null);
  const [saving,setSaving] = useState(false);
  const [toast,setToast] = useState("");
  const [notificationsEnabled,setNotificationsEnabled] = useState(false);
  const [notificationReminders,setNotificationReminders] = useState<NotificationReminder[]>([]);
  const [cvText,setCvText] = useState("");
  const [cvFileName,setCvFileName] = useState("");
  const [readingCv,setReadingCv] = useState(false);
  const [cvReadProgress,setCvReadProgress] = useState(0);
  const [adaptedCv,setAdaptedCv] = useState("");
  const [adaptingCv,setAdaptingCv] = useState(false);
  const [interviewPrep,setInterviewPrepState] = useState<Application|null>(null);
  const [prepMode,setPrepMode] = useState<"guide"|"simulation">("guide");
  const [prepQuestionIndex,setPrepQuestionIndex] = useState(0);
  const [prepAnswer,setPrepAnswer] = useState("");
  const [prepFeedback,setPrepFeedback] = useState("");

  const notify = (message:string) => { setToast(message); window.setTimeout(()=>setToast(""),2600); };

  function openInterviewPrep(application:Application) {
    setInterviewPrepState(application); setPrepMode("guide"); setPrepQuestionIndex(0); setPrepAnswer(""); setPrepFeedback("");
  }
  function setInterviewPrep(application:Application|null) {
    if (application) openInterviewPrep(application); else setInterviewPrepState(null);
  }

  function evaluateInterviewAnswer() {
    if (!interviewPrep) return;
    const answer = prepAnswer.trim();
    if (answer.length < 40) { setPrepFeedback("Votre réponse est encore trop courte. Ajoutez le contexte, votre action et le résultat obtenu."); return; }
    const hasStructure = /situation|contexte|t[aâ]che|action|r[eé]sultat|impact|chiffre|%|€/.test(answer.toLowerCase());
    setPrepFeedback(hasStructure
      ? "Bonne base : votre réponse contient des éléments concrets. À l’oral, commencez par l’idée principale et terminez par le résultat."
      : "Réponse claire, mais rendez-la plus convaincante avec la méthode STAR et un résultat mesurable.");
  }

  function nextInterviewQuestion() {
    if (!interviewPrep) return;
    const questions = interviewQuestions(interviewPrep);
    if (prepQuestionIndex >= questions.length - 1) { setPrepFeedback("Simulation terminée. Relisez vos réponses et notez un exemple chiffré à réutiliser."); return; }
    setPrepQuestionIndex((current)=>current+1); setPrepAnswer(""); setPrepFeedback("");
  }

  const loadData = useCallback(async () => {
    setError("");
    try {
      const meResponse = await fetch("/api/me",{cache:"no-store"});
      const meData = await meResponse.json();
      setCurrentUser(meData.user ?? null); setIsAdmin(Boolean(meData.isAdmin)); setConsentRequired(Boolean(meData.consentRequired)); setSuspension(meData.suspended?String(meData.suspensionReason||"Compte suspendu"):null); setAuthChecked(true);
      if (!meData.user) { setApplications([]); setProfile(null); setActivity([]); return; }
      if (meData.suspended || meData.consentRequired) { setApplications([]); setProfile(null); setActivity([]); return; }
      const [appsResponse,profileResponse,activityResponse] = await Promise.all([fetch("/api/applications",{cache:"no-store"}),fetch("/api/profile",{cache:"no-store"}),fetch("/api/activity",{cache:"no-store"})]);
      if (!appsResponse.ok || !profileResponse.ok || !activityResponse.ok) throw new Error(appsResponse.status===401?"Votre session a expiré. Reconnectez-vous.":"Impossible de charger vos données.");
      const appsData = await appsResponse.json(); const profileData = await profileResponse.json(); const activityData = await activityResponse.json();
      setApplications(appsData.applications ?? []); setProfile(profileData.profile ?? null); setActivity(activityData.activity ?? []);
    } catch (cause) { setError(cause instanceof Error?cause.message:"Erreur inattendue"); }
    finally { setLoading(false); }
  },[]);

  useEffect(()=>{ const timer=window.setTimeout(()=>void loadData(),0); return()=>window.clearTimeout(timer); },[loadData]);
  useEffect(()=>{ if (!currentUser) return; const timer=window.setTimeout(()=>void syncNotifications(true),0); const interval=window.setInterval(()=>void syncNotifications(true),60000); return()=>{window.clearTimeout(timer);window.clearInterval(interval);}; },[currentUser]);

  async function syncNotifications(showBrowserAlerts = false) {
    const response = await fetch("/api/notifications", { cache:"no-store" });
    if (!response.ok) return;
    const data = await response.json() as {enabled?:boolean; reminders?:NotificationReminder[]};
    setNotificationsEnabled(Boolean(data.enabled));
    const next = data.reminders ?? [];
    setNotificationReminders(next);
    if (!showBrowserAlerts || !data.enabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const storageKey = `fala-notified-${currentUser?.email ?? "user"}`;
    const already = new Set(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as string[]);
    next.filter((item) => new Date(item.date).getTime() <= Date.now() + 24 * 60 * 60 * 1000).forEach((item) => {
      const key = `${item.id}-${item.type}-${item.date}`;
      if (already.has(key)) return;
      new Notification(`Fala AI · ${item.type}`, { body:`${item.role} chez ${item.company} — ${formatDate(item.date)}` });
      already.add(key);
    });
    window.sessionStorage.setItem(storageKey, JSON.stringify([...already].slice(-50)));
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { notify("Les notifications ne sont pas prises en charge par ce navigateur"); return; }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await fetch("/api/notifications", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({enabled:true}) });
      setNotificationsEnabled(true);
      new Notification("Fala AI — rappels activés", { body: "Vous recevrez les échéances enregistrées dans vos candidatures." });
      notify("Notifications navigateur activées");
      await syncNotifications(true);
    } else {
      await fetch("/api/notifications", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({enabled:false}) });
      setNotificationsEnabled(false); notify("Autorisation de notifications refusée");
    }
  }

  async function adaptCvToOffer() {
    if (offerText.trim().length < 40 || cvText.trim().length < 80) {
      setError("Ajoutez au moins 40 caractères d’annonce et 80 caractères de CV avant de lancer la restructuration.");
      return;
    }
    setAdaptingCv(true); setError(""); setAdaptedCv("");
    try {
      const response = await fetch("/api/cv/adapt", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ offer:offerText, cv:cvText }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error ?? "Adaptation du CV impossible"); return; }
      const result = String(body.adaptedCv ?? "").trim();
      if (!result) { setError("Aucun contenu n’a été généré. Vérifiez le texte de l’annonce et du CV."); return; }
      setAdaptedCv(result); notify(body.provider === "moteur local" ? "CV restructuré avec le moteur intégré" : "CV restructuré avec l’assistant IA");
    } catch { setError("Le service d’analyse est momentanément indisponible. Vérifiez votre connexion puis réessayez."); }
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
  const interviewTarget = useMemo(()=>applications.find((application)=>application.status==="Entretien") ?? applications[0] ?? null,[applications]);

  async function acceptConsent(){setSaving(true);const response=await fetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accepted:true})});setSaving(false);if(!response.ok){const body=await response.json();setError(body.error??"Consentement impossible");return;}setConsentRequired(false);void loadData();}

  async function analyzeOffer(){setSaving(true);setError("");const response=await fetch("/api/offer/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:offerText})});const body=await response.json();setSaving(false);if(!response.ok){setError(body.error??"Analyse impossible");return;}setParsedOffer(body.parsed);setModal("add");notify("Annonce analysée — vérifiez les champs");}

  async function submitReport(form:FormData){setSaving(true);const response=await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(form.entries()))});const body=await response.json();setSaving(false);if(!response.ok){setError(body.error??"Envoi impossible");return;}setModal(null);notify("Signalement transmis à l’administration");}

  async function deleteAccount(){const confirmation=window.prompt("Cette action est irréversible. Saisissez SUPPRIMER pour confirmer.");if(confirmation!=="SUPPRIMER")return;const response=await fetch("/api/account",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation})});const body=await response.json();if(!response.ok){setError(body.error??"Suppression impossible");return;}window.location.href=body.signOut;}

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

  if (!authChecked || loading) return <main className="public-shell"><div className="public-loader"><span className="brand-mark">F</span><p>Ouverture de Fala AI…</p></div></main>;

  if (!currentUser) return <main className="public-shell">
    <div className="neural-field" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <header className="public-nav"><div className="brand"><span className="brand-mark">F</span><span>Fala <b>AI</b></span></div><div className="public-auth-links"><a className="public-login" href="/auth">Connexion</a><a className="public-register" href="/auth?mode=register">Créer un compte</a></div></header>
    <section className="public-hero"><div className="public-copy"><span className="public-kicker">SUIVI INTELLIGENT DES CANDIDATURES</span><h1>Votre recherche d’emploi.<br/><em>Enfin sous contrôle.</em></h1><p>Centralisez vos candidatures, calculez leur compatibilité et pilotez chaque prochaine action depuis un espace privé.</p><div className="public-actions"><a className="public-cta" href="/auth?mode=register">Créer mon espace →</a><span>Identité vérifiée · Données isolées · Historique conservé</span></div></div><div className="public-orbit" aria-hidden="true"><div className="public-core"><span>94</span><small>MATCH</small></div><i className="orbit-card one">Candidature</i><i className="orbit-card two">Entretien</i><i className="orbit-card three">Offre</i></div></section>
    <section className="public-features"><article><span>01</span><h2>Pipeline vivant</h2><p>Liste, Kanban, statuts et échéances restent synchronisés avec vos données.</p></article><article><span>02</span><h2>Scoring explicable</h2><p>Chaque score s’appuie sur vos compétences, votre expérience et vos préférences.</p></article><article><span>03</span><h2>Suivi personnel</h2><p>Vos candidatures appartiennent uniquement à votre compte authentifié.</p></article></section><footer className="public-footer"><a href="/privacy">Confidentialité</a><a href="/terms">Conditions d’utilisation</a></footer>
  </main>;

  if(suspension)return <main className="account-state"><span className="brand-mark">F</span><h1>Compte suspendu</h1><p>{suspension}</p><p>Vous pouvez demander un examen à l’administrateur : ibrahimapoukone@gmail.com.</p><a href="/api/auth/logout">Se déconnecter</a></main>;

  if(consentRequired)return <main className="consent-shell"><section className="consent-card"><span className="brand-mark">F</span><p className="eyebrow">PROTECTION DE VOS DONNÉES</p><h1>Bienvenue dans votre espace Fala AI</h1><p>Pour activer votre espace personnel, confirmez que vous avez lu la politique de confidentialité et les conditions d’utilisation. Vos candidatures restent privées et vous pourrez exporter ou supprimer vos données à tout moment.</p><label className="consent-check"><input type="checkbox" checked={consentAccepted} onChange={(event)=>setConsentAccepted(event.target.checked)}/>J’accepte le traitement de mes données pour fournir le service Fala AI.</label><div><a href="/privacy" target="_blank">Politique de confidentialité</a><a href="/terms" target="_blank">Conditions d’utilisation</a></div><button className="primary" disabled={!consentAccepted||saving} onClick={()=>void acceptConsent()}>{saving?"Activation…":"Activer mon espace"}</button><a href="/api/auth/logout">Refuser et se déconnecter</a></section></main>;

  return <main className="app-shell">
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
        <div className="top-actions"><span className="live"><i/>{currentUser.displayName}</span><button className="notification-button" onClick={()=>setModal("notifications")} aria-label={`${reminders.length} rappels`}>♢{reminders.length>0&&<b>{reminders.length}</b>}</button><button className="primary" onClick={()=>setModal("import")}>＋ Ajouter</button><details className="mobile-menu"><summary aria-label="Ouvrir le menu">•••</summary><div><a href="#dashboard">Vue d’ensemble</a><a href="#applications">Candidatures</a><a href="#analytics">Statistiques</a><button onClick={()=>setModal("profile")}>Profil de scoring</button><button onClick={()=>setModal("privacy")}>Mes données</button><button onClick={()=>setModal("report")}>Signaler un problème</button>{isAdmin&&<a href="/admin">Administration</a>}<a href="/api/auth/logout">Se déconnecter</a></div></details></div>
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

    {modal==="profile"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="profile-title">Profil de scoring</h2><p>Ces critères servent au calcul automatique. Toute modification recalcule aussi vos candidatures existantes.</p><form action={saveProfile}><div className="form-grid"><label>Poste recherché<input name="targetTitle" defaultValue={profile?.target_title||""} required/></label><label>Localisation cible<input name="location" defaultValue={profile?.location||""} required/></label><label>Contrat<select name="contractType" defaultValue={profile?.contract_type||""} required><option value="">Choisir</option><option>CDI</option><option>CDD</option><option>Alternance</option><option>Stage</option><option>Freelance</option></select></label><label>Expérience<select name="experienceLevel" defaultValue={profile?.experience_level||""}><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationLevel" defaultValue={profile?.education_level||""}><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0" defaultValue={profile?.salary_min||0}/></label><label className="span-2">Compétences<input name="skills" defaultValue={profile?.skills||""} placeholder="Python, SQL, Power BI" required/></label><label>Langues<input name="languages" defaultValue={profile?.languages||""} placeholder="Français, Anglais"/></label><label>Secteurs<input name="sectors" defaultValue={profile?.sectors||""} placeholder="Tech, Santé"/></label></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer et recalculer"}</button></div></form></div></div>}

    {modal==="add"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">＋</span><h2 id="add-title">Ajouter une candidature</h2><p>Les champs extraits restent modifiables avant enregistrement. Aucune information manquante n’est inventée.</p><form key={JSON.stringify(parsedOffer)} action={addApplication}><div className="form-grid"><label>Entreprise<input name="company" defaultValue={parsedOffer?.company||""} required autoFocus/></label><label>Poste<input name="role" defaultValue={parsedOffer?.role||""} required/></label><label>Localisation<input name="location" defaultValue={parsedOffer?.location||""}/></label><label>Type de contrat<select name="contractType" defaultValue={parsedOffer?.contractType||""}><option value="">Non précisé</option><option>CDI</option><option>CDD</option><option>Alternance</option><option>Stage</option><option>Freelance</option></select></label><label>Source<input name="source" defaultValue={parsedOffer?.source||""} placeholder="LinkedIn, France Travail…"/></label><label>Statut<select name="status" defaultValue="À préparer">{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label className="span-2">Compétences demandées<input name="requiredSkills" defaultValue={parsedOffer?.requiredSkills||""} placeholder="Python, SQL, dbt"/></label><label>Expérience demandée<select name="experienceRequired" defaultValue={parsedOffer?.experienceRequired||""}><option value="">Non précisée</option><option>Débutant</option><option>1-3 ans</option><option>3-5 ans</option><option>5+ ans</option></select></label><label>Niveau d’études<select name="educationRequired" defaultValue={parsedOffer?.educationRequired||""}><option value="">Non précisé</option>{educationLevels.map((level)=><option key={level}>{level}</option>)}</select></label><label>Langues<input name="languages" defaultValue={parsedOffer?.languages||""}/></label><label>Secteur<input name="sector" defaultValue={parsedOffer?.sector||""}/></label><label>Salaire minimum (€)<input name="salaryMin" type="number" min="0" defaultValue={parsedOffer?.salaryMin||0}/></label><label>Date de candidature<input name="appliedAt" type="date"/></label><label>Prochaine action<input name="nextActionAt" type="datetime-local"/></label><label>Entretien<input name="interviewAt" type="datetime-local"/></label><label className="span-2">Notes<textarea name="notes" rows={3} defaultValue={parsedOffer?.notes||""}/></label></div><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer durablement"}</button></div></form></div></div>}

    {modal==="import"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">⌁</span><h2 id="import-title">Analyser une offre et préparer votre CV</h2><p>Collez l’annonce pour extraire les critères, puis ajoutez votre CV. Le résultat reste fondé uniquement sur votre contenu et est structuré pour une lecture ATS.</p><label className="file-picker">Importer l’annonce (TXT, MD ou CSV)<input type="file" accept=".txt,.md,.csv,text/plain,text/csv" onChange={async(event)=>{const file=event.target.files?.[0];if(file)setOfferText(await file.text());}}/></label><label>Texte de l’annonce<textarea rows={8} value={offerText} onChange={(event)=>setOfferText(event.target.value)} placeholder="Collez ici le contenu de l’annonce…"/></label><div className="modal-actions"><button type="button" onClick={()=>{setParsedOffer(null);setModal("add");}}>Saisie manuelle</button><button className="primary" disabled={saving||offerText.trim().length<30} onClick={()=>void analyzeOffer()}>{saving?"Analyse…":"Extraire les informations"}</button></div><hr/><label className="file-picker">Importer votre CV (PDF, DOCX ou texte)<input type="file" accept=".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={async(event)=>{const file=event.target.files?.[0];if(!file)return;setCvFileName(file.name);setAdaptedCv("");setReadingCv(true);setCvReadProgress(5);try{setCvText(await readCvFile(file,(value)=>setCvReadProgress(value)));setError("");}catch(cause){setError(cause instanceof Error?cause.message:"Lecture du CV impossible");}finally{setReadingCv(false);}}}/></label>{readingCv&&<div className="cv-progress" role="status"><span className="loading-ring"/><div><strong>Lecture du CV en cours… {cvReadProgress}%</strong><div className="progress-track"><i style={{width:`${cvReadProgress}%`}}/></div></div></div>}<div className="cv-file-status"><strong>{cvFileName ? `Fichier sélectionné : ${cvFileName}` : "Aucun fichier sélectionné"}</strong><span>Le texte sera extrait automatiquement pour l’analyse.</span></div><small className="input-hint">Offre : {offerText.trim().length} caractères · CV extrait : {cvText.trim().length} caractères</small><button className="primary" disabled={readingCv||adaptingCv||offerText.trim().length<40||cvText.trim().length<80} onClick={()=>void adaptCvToOffer()}>{readingCv?"Lecture du CV…":adaptingCv?"Préparation…":"Adapter mon CV aux critères ATS"}</button>{adaptedCv&&<label className="cv-result">CV adapté — vérifiez chaque information avant envoi<textarea rows={14} value={adaptedCv} onChange={(event)=>setAdaptedCv(event.target.value)} /><span className="download-actions"><button type="button" className="ghost-button" onClick={()=>void navigator.clipboard?.writeText(adaptedCv)}>Copier</button><button type="button" className="ghost-button" onClick={()=>downloadPdf(adaptedCv)}>Télécharger PDF</button><button type="button" className="ghost-button" onClick={()=>void downloadDocx(adaptedCv)}>Télécharger DOCX</button></span></label>}</div></div>}

    {modal==="privacy"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal data-modal" role="dialog" aria-modal="true" aria-labelledby="data-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">⌁</span><h2 id="data-title">Mes données</h2><p>Vous gardez le contrôle sur les informations associées à votre compte.</p><div className="data-actions"><a href="/api/account/export" download>Exporter toutes mes données (JSON)</a><a href="/privacy" target="_blank">Lire la politique de confidentialité</a><a href="/terms" target="_blank">Lire les conditions d’utilisation</a><button className="danger-button" onClick={()=>void deleteAccount()}>Supprimer mon compte et tout l’historique</button></div></div></div>}

    {modal==="report"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">!</span><h2 id="report-title">Signaler un problème</h2><p>Votre signalement sera visible dans le centre de contrôle administrateur.</p><form action={submitReport}><label>Catégorie<select name="category"><option>Problème technique</option><option>Données personnelles</option><option>Abus</option><option>Suggestion</option></select></label><label>Description<textarea name="message" rows={6} minLength={10} required/></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Annuler</button><button className="primary" disabled={saving}>{saving?"Envoi…":"Envoyer"}</button></div></form></div></div>}

    {modal==="notifications"&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><div className="modal reminders-modal" role="dialog" aria-modal="true" aria-labelledby="reminders-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setModal(null)} aria-label="Fermer">×</button><span className="modal-icon">♢</span><h2 id="reminders-title">Rappels et échéances</h2><p>Fala AI vérifie vos prochaines actions et entretiens. Une notification est affichée sur cet appareil dans les 24 heures avant l’échéance lorsque vous avez donné votre accord.</p><button className="primary notification-enable" onClick={()=>void enableNotifications()} disabled={notificationsEnabled}>{notificationsEnabled?"✓ Notifications activées":"Activer les notifications"}</button><div className="reminder-list">{(notificationReminders.length?notificationReminders:reminders.map((item)=>({id:item.application.id,type:item.type,date:item.date!,company:item.application.company,role:item.application.role,status:item.application.status}))).map((item,index)=><button key={`${item.type}-${item.date}-${index}`} onClick={()=>{const application=applications.find((candidate)=>candidate.id===item.id);if(application)setSelected(application);setModal(null);}}><span>{item.type}</span><strong>{item.role} · {item.company}</strong><time>{formatDate(item.date)}</time></button>)}{!(notificationReminders.length||reminders.length)&&<p>Aucune échéance programmée.</p>}</div></div></div>}

    {interviewPrep&&<div className="modal-backdrop" onMouseDown={()=>setInterviewPrep(null)}><div className="modal wide-modal interview-modal" role="dialog" aria-modal="true" aria-labelledby="prep-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setInterviewPrep(null)} aria-label="Fermer">×</button><span className="modal-icon">◎</span><h2 id="prep-title">Préparer votre entretien</h2><p>{interviewPrep.role} · {interviewPrep.company}</p><div className="prep-tabs"><button className={prepMode==="guide"?"active":""} onClick={()=>setPrepMode("guide")}>Guide express</button><button className={prepMode==="simulation"?"active":""} onClick={()=>setPrepMode("simulation")}>Simulation interactive</button></div>{prepMode==="guide"?<><div className="prep-list"><article><strong>1. Votre présentation</strong><p>Préparez une réponse de 60 à 90 secondes : parcours, expertise principale et lien avec ce poste.</p></article><article><strong>2. Trois exemples concrets</strong><p>Utilisez la méthode STAR (situation, tâche, action, résultat) pour illustrer les compétences demandées.</p></article><article><strong>3. Questions à poser</strong><p>Demandez les priorités des 90 premiers jours, les critères de réussite et les prochaines étapes.</p></article><article><strong>4. Dernière vérification</strong><p>Relisez l’annonce, préparez deux réalisations chiffrées et planifiez votre relance.</p></article></div><div className="modal-actions"><button className="primary" onClick={()=>setPrepMode("simulation")}>Commencer la simulation →</button></div></>:<><div className="simulation-progress"><span>QUESTION {prepQuestionIndex+1}/{interviewQuestions(interviewPrep).length}</span><div><i style={{width:`${((prepQuestionIndex+1)/interviewQuestions(interviewPrep).length)*100}%`}}/></div></div><article className="simulation-card"><span className="focus-label">{interviewQuestions(interviewPrep)[prepQuestionIndex].label}</span><h3>{interviewQuestions(interviewPrep)[prepQuestionIndex].prompt}</h3><p>{interviewQuestions(interviewPrep)[prepQuestionIndex].hint}</p><textarea rows={6} value={prepAnswer} onChange={(event)=>setPrepAnswer(event.target.value)} placeholder="Écrivez votre réponse comme si vous étiez face au recruteur…"/><small>{prepAnswer.trim().length} caractères · visez une réponse concrète</small></article>{prepFeedback&&<div className="prep-feedback" role="status"><strong>Feedback Fala AI</strong><p>{prepFeedback}</p></div>}<div className="modal-actions"><button type="button" onClick={evaluateInterviewAnswer} disabled={!prepAnswer.trim()}>Analyser ma réponse</button><button type="button" className="primary" onClick={nextInterviewQuestion}>{prepQuestionIndex===interviewQuestions(interviewPrep).length-1?"Terminer":"Question suivante →"}</button></div></>}</div></div>}

    {selected&&<div className="modal-backdrop" onMouseDown={()=>setSelected(null)}><div className="modal score-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSelected(null)} aria-label="Fermer">×</button>{selected.status==="Entretien"&&<button className="ghost-button interview-prep-trigger" onClick={()=>setInterviewPrep(selected)}>Préparer cet entretien →</button>}<div className="score-summary"><span className="score huge">{selected.score??"—"}<small>/100</small></span><div><span className="focus-label">{scoreLabel(selected.score)}</span><h2 id="detail-title">{selected.role}</h2><p>{selected.company} · {selected.location||"Localisation non précisée"}</p></div></div>{parseScoreBreakdown(selected.score_breakdown)&&<div className="score-bars">{Object.entries(parseScoreBreakdown(selected.score_breakdown)??{}).map(([label,value])=><div key={label}><div><span>{scoreNames[label]??label}</span><b>{value} / {scoreMaximums[label]??10}</b></div><progress value={value} max={scoreMaximums[label]??10}/></div>)}</div>}<form action={updateApplication}><div className="form-grid"><label>Statut<select name="status" defaultValue={selected.status}>{statuses.map((s)=><option key={s}>{s}</option>)}</select></label><label>Prochaine action<input name="nextActionAt" type="datetime-local" defaultValue={selected.next_action_at?.slice(0,16)||""}/></label><label>Entretien<input name="interviewAt" type="datetime-local" defaultValue={selected.interview_at?.slice(0,16)||""}/></label><label className="span-2">Notes<textarea name="notes" rows={4} defaultValue={selected.notes}/></label></div><div className="modal-actions split-actions"><button type="button" className="danger-button" onClick={()=>void removeApplication()}>Supprimer</button><span/><button type="button" onClick={()=>setSelected(null)}>Fermer</button><button className="primary" disabled={saving}>{saving?"Enregistrement…":"Enregistrer"}</button></div></form></div></div>}
    {toast&&<div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}
