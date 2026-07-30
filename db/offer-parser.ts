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
];
const SECTORS = ["Tech","Finance","Banque","Assurance","Santé","Industrie","Énergie","Retail","E-commerce","Conseil","Éducation","Transport","Immobilier","Télécom"];

function matchFirst(text:string,patterns:RegExp[]){for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return match[1].trim();}return "";}
function normalizeText(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function escapeSkill(value:string){return normalizeText(value).trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");}
function extractSkills(rawText:string){
  const normalizedText=normalizeText(rawText);
  return SKILL_DICTIONARY.filter((skill)=>[skill.name,...(skill.aliases??[])].some((target)=>{
    const escapedTarget=escapeSkill(target);
    return new RegExp(`(?:^|[^a-z0-9])${escapedTarget}(?=$|[^a-z0-9])`,"i").test(normalizedText);
  }));
}
function includes(text:string,value:string){return normalizeText(text).includes(normalizeText(value));}
function extractRole(rawText:string){
  const patterns=[
    /(?:descriptif|intitulé)\s+du\s+poste\s*:?\s*(?:en\s+tant\s+que\s+)?([^,.;\n]{3,80})/i,
    /(?:nous\s+)?recrutons\s+(?:un|une)?\s*([^,.;\n]{3,80})/i,
    /(?:poste|recherche)\s*:\s*([^,.;\n]{3,80})/i,
    /postulez\s+en\s+tant\s+que\s+([^,.;\n]{3,80})/i,
  ];
  for(const pattern of patterns){
    const match=rawText.match(pattern); if(!match?.[1])continue;
    const cleaned=match[1].replace(/\b(h\/f|f\/h|m\/f|f\/m)\b/gi,"").replace(/\(\s*\)/g,"").replace(/\s+(pour|dans|avec|afin|chez)\b.*/i,"").trim();
    if(cleaned.length>=3)return cleaned;
  }
  return null;
}

export function parseOfferText(source:string){
  const text=source.replace(/\r/g," ").replace(/[ \t]+/g," ").trim();
  if(text.length<40)throw new Error("L’annonce est trop courte pour être analysée.");
  const lines=source.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const contract=["CDI","CDD","Alternance","Stage","Freelance"].find(value=>new RegExp(`\\b${value}\\b`,"i").test(text))??"";
  const experience=matchFirst(text,[/(\d+)\s*(?:à|a|-)\s*(\d+)\s*ans?/i,/(\d+)\s*ans?\s+d['’]expérience/i]);
  const expNumber=Number(experience.match(/\d+/)?.[0]??0);
  const experienceRequired=experience?(expNumber>=5?"5+ ans":expNumber>=3?"3-5 ans":"1-3 ans"):(/débutant|junior|première expérience/i.test(text)?"Débutant":"");
  const educationMatch=text.match(/bac\s*\+?\s*(\d+)/i);
  const educationRequired=educationMatch?`Bac+${Math.min(8,Number(educationMatch[1]))}`:(/\bbac\b/i.test(text)?"Bac":"");
  const salaryRaw=matchFirst(text,[/(?:salaire|rémunération)[^\d]{0,20}(\d[\d\s]{3,})/i,/(\d{2,3})\s*k\s*(?:€|euros?)/i]);
  const salaryNumber=Number(salaryRaw.replace(/\s/g,""))||0;
  const salaryMin=/\d{2,3}\s*k/i.test(text)?salaryNumber*1000:salaryNumber;
  const languages=["Français","Anglais","Espagnol","Allemand","Italien","Arabe","Portugais"].filter(value=>includes(text,value));
  const skills=extractSkills(text);
  const sector=SECTORS.find(value=>includes(text,value))??"";
  const location=matchFirst(text,[/(?:lieu|localisation|poste basé à|basé à)\s*[:\-]?\s*([^.,;\n]{2,60})/i]);
  const remote=/télétravail|remote|à distance/i.test(text);const resolvedLocation=remote?(location?`${location}, Télétravail`:"Télétravail"):location;
  const company=matchFirst(text,[/(?:entreprise|société|company)\s*[:\-]\s*([^\n,;]{2,80})/i]);
  const role=extractRole(source)||matchFirst(text,[/(?:poste|intitulé|job title)\s*[:\-]\s*([^\n,;]{2,100})/i])||lines.find(line=>line.length>=4&&line.length<=100&&!/entreprise|société|description|descriptif du poste/i.test(line))||"";
  return {company,role,location:resolvedLocation,contractType:contract,requiredSkills:skills.map((skill)=>skill.name).join(", "),experienceRequired,educationRequired,languages:languages.join(", "),sector,salaryMin,source:"Annonce analysée",notes:`Annonce analysée automatiquement le ${new Date().toLocaleDateString("fr-FR")}. Vérifiez les champs avant enregistrement.`};
}
