import { getChatGPTUser } from "../../../chatgpt-auth";
import { parseOfferText } from "../../../../db/offer-parser";
import { POST as adaptCv } from "../adapt/route";

export const dynamic = "force-dynamic";

function normalize(value:string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

function summarizeCv(cv:string, offer:string) {
  const lines=cv.split(/\r?\n/).map((line)=>line.trim()).filter((line)=>line.length>1);
  const experience=lines.filter((line)=>/\b(20\d{2}|19\d{2})\b/.test(line)).slice(0,12);
  const skills=lines.filter((line)=>/comp[eé]tence|skill|outils?|technolog|logiciel|langues?/i.test(line)).slice(0,12);
  const parsed=parseOfferText(offer);
  const requested=String(parsed.requiredSkills??"").split(/[,;]+/).map((item)=>item.trim()).filter(Boolean);
  const normalizedCv=normalize(cv);
  const matched=requested.filter((item)=>normalizedCv.includes(normalize(item)));
  const missing=requested.filter((item)=>!normalizedCv.includes(normalize(item)));
  return {
    headline: lines[0] ?? "Profil professionnel",
    evidence: lines.slice(0,4),
    experience,
    skills,
    matchedSkills: matched,
    missingSkills: missing,
    sourceCharacters: cv.length,
  };
}

export async function POST(request:Request) {
  const user=await getChatGPTUser();
  if(!user) return Response.json({error:"Authentification requise"},{status:401});
  const body=await request.clone().json().catch(()=>({})) as {offer?:string;cv?:string};
  const offer=String(body.offer??"").trim(); const cv=String(body.cv??"").trim();
  if(offer.length<40||cv.length<80) return Response.json({error:"Fournissez une offre et un CV suffisamment détaillés."},{status:400});
  const adaptation=await adaptCv(request.clone());
  const result=await adaptation.json().catch(()=>({})) as Record<string,unknown>;
  if(!adaptation.ok) return Response.json(result,{status:adaptation.status});
  return Response.json({
    ok:true,
    summary:summarizeCv(cv,offer),
    adaptedCv:String(result.adaptedCv??""),
    matchedSkills:result.matchedSkills??[],
    matchedKeywords:result.matchedKeywords??[],
    targetRole:result.targetRole??null,
    provider:result.provider??"moteur local",
    note:"Le résumé et l’adaptation utilisent uniquement les éléments détectés dans le CV. Vérifiez le résultat avant utilisation.",
  });
}
