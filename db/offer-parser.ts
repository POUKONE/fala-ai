const SKILL_DICTIONARY = [
  {name:"Python"}, {name:"SQL"}, {name:"JavaScript",aliases:["js","ecmascript"]}, {name:"TypeScript",aliases:["ts"]},
  {name:"React",aliases:["reactjs","react.js"]}, {name:"Next.js",aliases:["nextjs"]}, {name:"Node.js",aliases:["nodejs"]},
  {name:"Java"}, {name:"C#"}, {name:"C++"}, {name:"PHP"}, {name:"Ruby"}, {name:"Go",aliases:["golang"]}, {name:"Rust"},
  {name:"AWS"}, {name:"Azure"}, {name:"GCP"}, {name:"Docker"}, {name:"Kubernetes"}, {name:"Terraform"},
  {name:"Power BI",aliases:["powerbi"]}, {name:"Tableau"}, {name:"Excel"}, {name:"Salesforce"}, {name:"SAP"}, {name:"Figma"},
  {name:"Git"}, {name:"dbt"}, {name:"Spark"}, {name:"Hadoop"}, {name:"Machine Learning"}, {name:"Data Analysis"},
  {name:"KPI",aliases:["KPIs"]}, {name:"Reporting"}, {name:"CRM"}, {name:"MRR"}, {name:"NRR"}, {name:"GRR"}, {name:"LTV"},
  {name:"Churn"}, {name:"CPQ"}, {name:"Business Intelligence",aliases:["BI"]}, {name:"Data Quality"},
  {name:"Financial Analysis"}, {name:"Process Improvement"},
  {name:"Gestion de projet"}, {name:"Gestion administrative"}, {name:"Relation client"}, {name:"Service client"},
  {name:"Vente"}, {name:"Négociation"}, {name:"Marketing"}, {name:"Communication"}, {name:"Ressources humaines",aliases:["RH"]},
  {name:"Droit"}, {name:"Conformité"}, {name:"Audit"}, {name:"Comptabilité"}, {name:"Contrôle de gestion"},
  {name:"Logistique"}, {name:"Achats"}, {name:"Supply Chain"}, {name:"Qualité"}, {name:"Sécurité"},
  {name:"Maintenance"}, {name:"Production"}, {name:"Conception"}, {name:"Formation"}, {name:"Pédagogie"},
  {name:"Recherche"}, {name:"Anglais"}, {name:"Français"}, {name:"Espagnol"}, {name:"Allemand"},
];
const SECTORS = ["Tech","Finance","Banque","Assurance","Juridique","Santé","Industrie","Énergie","Retail","E-commerce","Conseil","Éducation","Transport","Immobilier","Télécom","Ressources humaines","Hôtellerie","Restauration","Communication","Marketing","Logistique","Aéronautique","Automobile","Construction","Public"];
const ROLE_WORDS = /analyste|analysis|manager|directeur|directrice|responsable|ingénieur|ingenieur|développeur|developpeur|designer|commercial|commerciale|assistant|assistante|comptable|juriste|avocat|architecte|consultant|consultante|technicien|technicienne|chef de projet|coordinateur|coordinatrice|chargé|chargee|marketing|data|finance|rh|ressources humaines|infirmier|infirmière|professeur|enseignant|opérateur|ouvrier/i;

function repairEncoding(value:string){
  return value
    .replace(/â€™|â/g,"’").replace(/â€œ|â/g,"“").replace(/â€|â/g,"”")
    .replace(/â€“|â/g,"–").replace(/â€”|â/g,"—").replace(/â€¦|â¦/g,"…")
    .replace(/Ã©/g,"é").replace(/Ã¨/g,"è").replace(/Ãª/g,"ê").replace(/Ã«/g,"ë")
    .replace(/Ã /g,"à").replace(/Ã´/g,"ô").replace(/Ã»/g,"û").replace(/Ã§/g,"ç")
    .replace(/\u00a0/g," ");
}
function normalizeText(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function matchFirst(text:string,patterns:RegExp[]){for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return match[1].replace(/[|•·]+$/g,"").trim();}return "";}
function escapeSkill(value:string){return normalizeText(value).trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");}
function includes(text:string,value:string){return normalizeText(text).includes(normalizeText(value));}
function extractSkills(rawText:string){
  const normalizedText=normalizeText(rawText);
  return SKILL_DICTIONARY.filter((skill)=>[skill.name,...(skill.aliases??[])].some((target)=>{
    const escapedTarget=escapeSkill(target);
    return new RegExp(`(?:^|[^a-z0-9])${escapedTarget}(?=$|[^a-z0-9])`,"i").test(normalizedText);
  }));
}
function cleanRole(value:string){
  return value.replace(/\b(h\/f|f\/h|m\/f|f\/m|h-f|f-h)\b/gi,"").replace(/\([^)]*\)/g,"")
    .replace(/\s+(pour|dans|avec|afin|chez|au sein de)\b.*/i,"").replace(/[|•·,:;]+$/g,"").trim();
}
function extractRole(rawText:string,lines:string[]){
  const patterns=[
    /(?:descriptif|intitul[ée]|titre)\s+(?:du\s+)?poste\s*[:\-]?\s*(?:en\s+tant\s+que\s+)?([^,.;\n]{3,100})/i,
    /(?:nous\s+)?recrutons\s+(?:un|une|des)?\s*([^,.;\n]{3,100})/i,
    /(?:poste|recherche|job\s*title)\s*[:\-]\s*([^,.;\n]{3,100})/i,
    /postulez\s+(?:en\s+tant\s+que|au\s+poste\s+de)\s+([^,.;\n]{3,100})/i,
  ];
  for(const pattern of patterns){const match=rawText.match(pattern);const cleaned=match?.[1]?cleanRole(match[1]):"";if(cleaned.length>=3)return cleaned;}
  const candidate=lines.slice(0,18).map(line=>cleanRole(line)).find(line=>line.length>=4&&line.length<=100&&ROLE_WORDS.test(line)&&!/^(entreprise|missions?|profil|description|à propos|contexte|salaire)\b/i.test(line));
  return candidate??"";
}
function extractCompany(rawText:string,lines:string[]){
  const explicit=matchFirst(rawText,[/(?:entreprise|société|employeur|company|organisation)\s*[:\-]\s*([^\n,;|]{2,100})/i,/(?:au sein de|chez)\s+([A-ZÀ-Ý][^,.;\n]{2,80})/]);
  if(explicit)return explicit;
  const heading=lines.slice(0,12).find(line=>/\b( recrute|recherche|offre d'emploi|job)\b/i.test(line)&&/[|–—-]/.test(line));
  if(heading){const parts=heading.split(/\s*[|–—]\s*|\s+-\s+/).map(v=>v.trim()).filter(Boolean);if(parts.length>1)return parts[0].replace(/^(offre|emploi)\s*[:\-]?\s*/i,"");}
  return "";
}
function extractLocation(text:string){
  const location=matchFirst(text,[/(?:lieu|localisation|location|poste\s+bas[ée]|bas[ée]\s+à|situ[ée]\s+à)\s*[:\-]?\s*([^.,;|\n]{2,80})/i]);
  const remote=/t[ée]l[ée]travail|remote|hybride|[àa]\s+distance/i.test(text);
  return remote?(location?`${location}, Télétravail`:"Télétravail"):location;
}
function extractContract(text:string){
  const types=["CDI","CDD","Alternance","Apprentissage","Stage","Freelance","Intérim","Temps partiel"];
  return types.find(value=>new RegExp(`\\b${value}\\b`,"i").test(text))??"";
}
function extractExperience(text:string){
  const normalized=normalizeText(text);
  if(/sans experience|aucune experience|debutant|premiere experience|junior/.test(normalized))return "Débutant";
  const range=normalized.match(/(?:minimum\s+|au moins\s+|de\s+)?(\d+)\s*(?:[àa]|\-|à)\s*(\d+)\s*ans?/);
  const single=normalized.match(/(?:minimum\s+|au moins\s+|plus de\s+|environ\s+)?(\d+)\s*ans?\s*(?:d['’]?experience)?/);
  const max=Number(range?.[2]??single?.[1]??0), min=Number(range?.[1]??single?.[1]??0);
  if(!max)return "";
  if(range)return max>5?"5+ ans":max>=3?"3-5 ans":"1-3 ans";
  return min>=5?"5+ ans":min>=3?"3-5 ans":"1-3 ans";
}
function extractEducation(text:string){
  const normalized=normalizeText(text);
  const bac=normalized.match(/bac\s*\+\s*(\d+)/); if(bac)return `Bac+${Math.min(8,Number(bac[1]))}`;
  if(/doctorat|phd/.test(normalized))return "Doctorat"; if(/master|msc|mba/.test(normalized))return "Master";
  if(/licence|bachelor|bac\s+pro/.test(normalized))return /bac\s+pro/.test(normalized)?"Bac":"Licence";
  if(/\bbac\b/.test(normalized))return "Bac"; return "";
}
function extractSalary(text:string){
  const normalized=normalizeText(text).replace(/\u202f/g," ");
  const labelled=normalized.match(/(?:salaire|remuneration|package|remuneration\s+globale|compensation)[^\d]{0,50}(\d[\d .]{2,})(?:\s*(?:-|à|a|–|—)\s*(\d[\d .]{2,}))?\s*(k\s*)?(?:€|euros?|eur)?/i);
  if(labelled){
    const value=Number(labelled[1].replace(/[ .]/g,""));
    if(value>=1000)return value*(labelled[3]?1000:1);
  }
  const matches=[...normalized.matchAll(/(\d[\d .]*)(?:\s*(?:-|à|a|–|—)\s*(\d[\d .]*))?\s*(k\s*)?(?:€|euros?|eur)?/gi)]
    .map(match=>({a:Number(match[1].replace(/[ .]/g,"")),b:match[2]?Number(match[2].replace(/[ .]/g,"")):0,k:Boolean(match[3])}))
    .filter(item=>item.a>=1000||item.k);
  if(!matches.length)return 0;
  const item=matches.find(value=>/salaire|remuneration|package|remuneration|brut|annuel|an\b/i.test(normalized.slice(Math.max(0,normalized.indexOf(String(value.a))-80),normalized.indexOf(String(value.a))+80)))??matches[0];
  return (item.a*(item.k?1000:1));
}
function extractSource(text:string){
  const url=text.match(/https?:\/\/[^\s)]+/i)?.[0]; if(url){try{return new URL(url).hostname.replace(/^www\./,"");}catch{/* ignore */}}
  return /linkedin/i.test(text)?"LinkedIn":/france\s+travail|pole\s+emploi/i.test(text)?"France Travail":/welcome\s+to\s+the\s+jungle|welcometothejungle/i.test(text)?"Welcome to the Jungle":"Annonce analysée";
}
function extractNotes(source:string){
  const match=source.match(/(?:missions?|responsabilit[ée]s?|vos missions?)\s*[:\-]?\s*([\s\S]{0,700})/i);
  if(!match?.[1])return "";
  const excerpt=match[1].split(/(?:profil recherch[ée]|comp[ée]tences|formation|avantages|pourquoi nous rejoindre)\s*[:\-]?/i)[0].replace(/[ \t]+/g," ").trim();
  return excerpt?`Missions principales : ${excerpt.slice(0,500)}`:"";
}

export function parseOfferText(source:string){
  const repaired=repairEncoding(String(source??""));
  const text=repaired.replace(/\r/g," ").replace(/[ \t]+/g," ").trim();
  if(text.length<40)throw new Error("L’annonce est trop courte pour être analysée.");
  const lines=repaired.split(/\r?\n/).map(value=>value.replace(/^[\s•▪➢*-]+/,"").replace(/[ \t]+/g," ").trim()).filter(Boolean);
  const skills=extractSkills(text);
  const languages=["Français","Anglais","Espagnol","Allemand","Italien","Arabe","Portugais"].filter(value=>includes(text,value));
  const sector=SECTORS.find(value=>includes(text,value))??"";
  const location=extractLocation(text);
  const notes=extractNotes(repaired);
  return {
    company:extractCompany(repaired,lines),
    role:extractRole(repaired,lines),
    location,
    contractType:extractContract(text),
    requiredSkills:skills.map(skill=>skill.name).join(", "),
    experienceRequired:extractExperience(text),
    educationRequired:extractEducation(text),
    languages:languages.join(", "),
    sector,
    salaryMin:extractSalary(text),
    source:extractSource(repaired),
    notes:notes||`Annonce analysée automatiquement. ${skills.length} compétence(s) et les critères essentiels ont été extraits ; vérifiez les champs avant enregistrement.`,
  };
}
