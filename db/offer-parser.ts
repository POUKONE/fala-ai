const SKILLS = ["Python","SQL","JavaScript","TypeScript","React","Next.js","Node.js","Java","C#","C++","PHP","Ruby","Go","Rust","AWS","Azure","GCP","Docker","Kubernetes","Terraform","Power BI","Tableau","Excel","Salesforce","SAP","Figma","Git","dbt","Spark","Hadoop","Machine Learning","Data Analysis","KPI","Reporting","CRM","MRR","NRR","GRR","LTV","Churn","CPQ","Business Intelligence","Data Quality","Financial Analysis","Process Improvement"];
const SECTORS = ["Tech","Finance","Banque","Assurance","Santé","Industrie","Énergie","Retail","E-commerce","Conseil","Éducation","Transport","Immobilier","Télécom"];

function matchFirst(text:string,patterns:RegExp[]){for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return match[1].trim();}return "";}
function includes(text:string,value:string){return text.toLowerCase().includes(value.toLowerCase());}

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
  const skills=SKILLS.filter(value=>includes(text,value));
  const sector=SECTORS.find(value=>includes(text,value))??"";
  const location=matchFirst(text,[/(?:lieu|localisation|poste basé à|basé à)\s*[:\-]?\s*([^.,;\n]{2,60})/i]);
  const remote=/télétravail|remote|à distance/i.test(text);const resolvedLocation=remote?(location?`${location}, Télétravail`:"Télétravail"):location;
  const company=matchFirst(text,[/(?:entreprise|société|company)\s*[:\-]\s*([^\n,;]{2,80})/i]);
  const role=matchFirst(text,[
    /(?:poste|intitulé|job title)\s*[:\-]\s*([^\n,;]{2,100})/i,
    /descriptif\s+du\s+poste\s+(?:en\s+tant\s+que\s+)?([^,.;\n]{4,100})/i,
    /(?:recrutons|recherche(?:ons)?|looking\s+for)\s+(?:un[e]?\s+)?([^,.;\n]{4,100})/i,
  ])||lines.find(line=>line.length>=4&&line.length<=100&&!/entreprise|société|description|descriptif du poste/i.test(line))||"";
  return {company,role,location:resolvedLocation,contractType:contract,requiredSkills:skills.join(", "),experienceRequired,educationRequired,languages:languages.join(", "),sector,salaryMin,source:"Annonce analysée",notes:`Annonce analysée automatiquement le ${new Date().toLocaleDateString("fr-FR")}. Vérifiez les champs avant enregistrement.`};
}
