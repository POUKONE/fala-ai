import { getChatGPTUser } from "../../../chatgpt-auth";
import { parseOfferText } from "../../../../db/offer-parser";
import { enforceRateLimit, getAccountState, logSystemError } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function compact(value: string) { return normalize(value).replace(/[^a-z0-9]+/g, ""); }
function repairText(value: string) {
  return value
    // Séquences UTF-8 mal décodées fréquentes dans les exports PDF
    // (â + octets de contrôle). Les convertir avant de supprimer les
    // contrôles empêche qu'il reste un « â » isolé dans le CV final.
    .replace(/â(?:\u0080|€)?(?:\u0098|\u0099)/g, "'")
    .replace(/â(?:\u0080|€)?(?:\u0093|\u0094)/g, "-")
    .replace(/â(?:\u0080|€)?(?:\u0096|\u0097)/g, "-")
    .replace(/â€™|â/g, "'")
    .replace(/â€˜|â/g, "'")
    .replace(/â€œ|â/g, '"')
    .replace(/â€|â/g, '"')
    .replace(/â€“|â€”|â|â/g, "-")
    .replace(/â€¦|â¦/g, "...")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/dâ\s*experience/gi, "d'expérience")
    .replace(/(^|[\s([|])â(?=$|[\s)\].,;:!?])/g, "$1")
    .replace(/â(?=\s*(?:experience|expérience|ce|cette|les|le|la|un|une)\b)/gi, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uFFFD]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function qualityReport(source: string, output: string, matchedKeywords: string[]) {
  const normalized = normalize(output);
  const sections = ["experience", "formation", "competences", "profil"].filter((section) => normalized.includes(section));
  const coverage = matchedKeywords.length ? Math.round(matchedKeywords.filter((keyword) => compact(output).includes(compact(keyword))).length / matchedKeywords.length * 100) : 0;
  const warnings: string[] = [];
  if (compact(source) === compact(output)) warnings.push("Le contenu ressemble au CV source : vérifiez la restructuration.");
  if (output.length < Math.max(120, Math.round(source.length * 0.35))) warnings.push("Le résultat est nettement plus court que le CV source.");
  if (sections.length < 2) warnings.push("Moins de deux sections ATS standard ont été détectées.");
  return { sourceCharacters: source.length, resultCharacters: output.length, sections, keywordCoverage: coverage, warnings };
}
const STOP_WORDS = new Set("avec pour dans une des les aux sur par vous votre nous notre cette comme plus sont être avoir poste entreprise expérience travail recherche niveau afin ainsi chez depuis sous entre selon sans très aux du de et ou en le la un une au ce se qui que est".split(" "));
const SECTION_ALIASES = [
  {name:"EXPÉRIENCE", test:/^(exp[eé]rience|exp[eé]riences|exp[eé]rience professionnelle|parcours professionnel|emploi|professional experience)(?:\s*:)?$/i},
  {name:"FORMATION", test:/^(formation|formations|education|[eé]tudes|dipl[oô]mes?)(?:\s*:)?$/i},
  {name:"FORMATION", test:/^(certifications?(?:\s+et\s+formations?)?|formations?\s+et\s+certifications?|certificat)(?:\s*:)?$/i},
  {name:"COMPÉTENCES", test:/^(comp[eé]tences?|skills|savoir[- ]faire|expertise)/i},
  {name:"COMPÉTENCES", test:/^(mon\s+portfolio\s+informatique|portfolio\s+informatique|technologies?|tech\s+stack|outils?)(?:\s*:)?/i},
  {name:"COMPÉTENCES", test:/^(hard\s+skills?|soft\s+skills?|comp[eé]tences?\s+(?:techniques?|m[eé]tiers?|informatiques?)|atouts?)(?:\s*:)?/i},
  {name:"PROFIL", test:/^(profil|r[eé]sum[eé]|objectif|summary|about|objectif\s+professionnel|profil\s+professionnel)/i},
  {name:"LANGUES", test:/^(langues?|languages?)(?:\s*:)?$/i},
  {name:"PROJETS", test:/^(projets?|projects?)(?:\s*:)?$/i},
  {name:"CENTRES D'INTÉRÊT", test:/^(centres? d['’ ]int[eé]r[eê]t|centres? d['’ ]inter[eé]t|int[eé]r[eê]ts?|loisirs?|interests?)(?:\s*:)?$/i},
];
function canonicalSection(line:string) { return SECTION_ALIASES.find((section)=>section.test.test(line))?.name ?? null; }
function inlineSection(line:string) {
  const match=line.match(/^(profil|r[eé]sum[eé]|summary|objectif(?:\s+professionnel)?|profil\s+professionnel|langues?|languages?|centres? d['’ ]int[eé]r[eê]t|centres? d['’ ]inter[eé]t|int[eé]r[eé]ts?|loisirs?|interests?|certifications?(?:\s+et\s+formations?)?|formations?\s+et\s+certifications?|mon\s+portfolio\s+informatique|portfolio\s+informatique|technologies?|tech\s+stack|outils?|hard\s+skills?|soft\s+skills?|atouts?)\s*:\s*(.+)$/i);
  if(!match) return null;
  const label=match[1].toLowerCase();
  const name=/profil|r[eé]sum[eé]|summary|objectif/.test(label) ? "PROFIL" : /lang|language/.test(label) ? "LANGUES" : /int[eé]r|loisir|interest/.test(label) ? "CENTRES D'INTÉRÊT" : /portfolio|technolog|tech\s+stack|outil|hard\s+skill|soft\s+skill|atout/.test(label) ? "COMPÉTENCES" : "FORMATION";
  return {name,content:match[2].trim()};
}
function usefulCvLine(line:string) { return line.length>1 && !/r[eé]sumez vos responsabilit[eé]s|utilisez la langue|soyez concis|exemple de cv|votre nom|[x]{3,}/i.test(normalize(line)); }
function splitSkillTail(line:string) {
  // Certains PDF placent une colonne « technologies » après un point-virgule
  // dans la même ligne qu'une réalisation. Une liste de 2+ éléments séparés
  // par des virgules est traitée comme une compétence, jamais comme un impact.
  const match=line.match(/^(.*?);\s*((?:[^,;\n]{1,42},\s*){2,}[^,;\n]{1,42})\s*$/);
  if(!match) return {main:line,skills:[] as string[]};
  const tail=match[2].split(/,\s*/).map((item)=>repairText(item)).filter((item)=>item.length>1);
  if(tail.length<3) return {main:line,skills:[] as string[]};
  return {main:match[1].trim(),skills:tail};
}
function looksLikeSkillInventory(line:string) {
  const value=repairText(line);
  if(value.split(/,\s*/).length<3) return false;
  return !/\b(conception|analyse|animation|développement|developpement|implémentation|implementation|optimisation|intégration|integration|réalisation|managed|created|led|designed|developed|analysed|implemented)\b/i.test(value);
}
function buildSummary(target:string, profileItems:string[], experienceItems:string[], skillItems:string[], educationItems:string[]) {
  const cleanProfile=profileItems.map(repairText).filter(Boolean).join(" ");
  if(cleanProfile) return cleanProfile;
  const experienceText=experienceItems.map(repairText).join(" ");
  const domains:string[]=[];
  if(/power\s*bi|python|sql|statist|donn[eé]es|\bdata\b|tableaux? de donn[eé]es/i.test(experienceText)) domains.push("analyse de données");
  if(/web|html|css|javascript|php|react|angular|d[eé]veloppement logiciel/i.test(experienceText)) domains.push("développement numérique");
  if(/tableaux? de bord|reporting|indicateur|kpi/i.test(experienceText)) domains.push("reporting et pilotage");
  if(/juriste|juridique|contrat|contentieux|droit|conformit[eé]/i.test(experienceText)) domains.push("droit et conformité");
  if(/client|vente|commercial|n[eé]gociation|prospection/i.test(experienceText)) domains.push("relation commerciale");
  if(/logistique|approvisionnement|stock|supply\s*chain|transport/i.test(experienceText)) domains.push("logistique");
  if(/maintenance|production|industri|qualit[eé]|revit|m[eé]canique|[eé]lectric/i.test(experienceText)) domains.push("activité industrielle");
  const level=educationItems.find((item)=>/bac\s*\+\s*\d|master|licence|bts/i.test(item));
  const subject=domains.length ? domains.slice(0,3).join(", ") : "informatique";
  const qualification=level ? ` Parcours de formation documenté : ${repairText(level)}.` : "";
  const goal=target ? ` Candidature ciblée : ${repairText(target)}.` : "";
  return `Profil orienté ${subject}, avec des réalisations documentées dans le CV source.${qualification}${goal}`.trim();
}
const DATE_TOKEN = `(?:\\d{1,2}[\\/. -]\\d{4}|(?:19|20)\\d{2}|20xx|(?:jan(?:v(?:ier|uary)?)?|feb(?:r(?:ier|uary)?)?|mar(?:s|ch)?|apr(?:il)?|mai|may|juin|june|juil(?:let|y)?|july|ao[uû]t|aug(?:ust)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|nov(?:embre|ember)?|d[eé]c(?:embre|ember)?)\\s+(?:19|20)\\d{2}|(?:jan(?:v(?:ier|uary)?)?|feb(?:r(?:ier|uary)?)?|mar(?:s|ch)?|apr(?:il)?|mai|may|juin|june|juil(?:let|y)?|july|ao[uû]t|aug(?:ust)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|nov(?:embre|ember)?|d[eé]c(?:embre|ember)?)\\s+20xx)`;
const DATE_LINE = new RegExp(`^${DATE_TOKEN}\\s*(?:[-–—]|à|a|aujourd'hui|à?\\s*ce\\s+jour|en\\s+cours|present|présent)?`, "i");
function isDateLine(line:string) { return DATE_LINE.test(line.trim()); }
function looksLikeEducationLine(line:string) {
  return isDateLine(line) && /\b(?:bac|bts|master|licence|bachelor|cycle\s+pr[eé]paratoire|ecam|epmi|universit[eé]|[eé]cole)\b/i.test(line);
}
function normalizeDateRange(line:string) {
  const match=line.match(/^(\d{1,2}[\/.-]\d{4}|(?:19|20)\d{2})\s*[-–—]\s*(\d{1,2}[\/.-]\d{4}|(?:19|20)\d{2})(.*)$/);
  if(!match) return line;
  const value=(date:string)=>{const parts=date.match(/(\d{1,2})[\/.-](\d{4})/);return parts?Number(parts[2])*100+Number(parts[1]):Number(date)*100;};
  return value(match[1])>value(match[2]) ? `${match[2]} - ${match[1]}${match[3]}` : line;
}
function splitEmbeddedSections(text:string) {
  return text
    // Les rubriques PDF sont généralement en capitales. Limiter cette
    // séparation aux capitales évite de couper une phrase comme « expérience
    // en analyse » au milieu du résumé.
    .replace(/\s+(?=(?:PROFIL|PROFILE|RÉSUMÉ|RESUME|SUMMARY|OBJECTIF|EXPÉRIENCES?|EXPERIENCES?|PARCOURS PROFESSIONNEL|PROFESSIONAL EXPERIENCE|FORMATIONS?|EDUCATION|ÉTUDES|ETUDES|DIPLÔMES?|DIPLOMES?|COMPÉTENCES?|COMPETENCES?|SKILLS|SAVOIR[- ]FAIRE|LANGUES?|LANGUAGES?|PROJETS?|PROJECTS?|CENTRES? D['’ ]INT[ÉE]R[ÊE]T|INT[ÉE]R[ÊE]TS?|LOISIRS?)\b)/g, "\n")
    .replace(/(^|\n)\s*(PROFIL|PROFILE|RÉSUMÉ|RESUME|SUMMARY|OBJECTIF|EXPÉRIENCES?|EXPERIENCES?|PARCOURS PROFESSIONNEL|PROFESSIONAL EXPERIENCE|FORMATIONS?|EDUCATION|ÉTUDES|ETUDES|DIPLÔMES?|DIPLOMES?|COMPÉTENCES?|COMPETENCES?|SKILLS|SAVOIR[- ]FAIRE|LANGUES?|LANGUAGES?|PROJETS?|PROJECTS?|CENTRES? D['’ ]INT[ÉE]R[ÊE]T|INT[ÉE]R[ÊE]TS?|LOISIRS?)\s*:?[ \t]+(?=\S)/gm, "$1$2\n")
    .replace(/\n{3,}/g, "\n\n");
}
export function buildLocalAdaptation(cv:string,target:string,matchedSkills:string[],matchedKeywords:string[] = []) {
  // Les PDF à plusieurs colonnes recollent parfois les rubriques et les
  // dates sur une même ligne. On recrée uniquement les séparations connues,
  // sans réécrire le contenu du candidat.
  const prepared=splitEmbeddedSections(cv
    .replace(/[｜¦]/g,"|")
    .replace(/([\p{L}]+)-[ \t]*\n[ \t]*([\p{Ll}]+)/gu, (_match,left,right)=>left.length>=6 && right.length<=3 ? `${left} ${right}` : `${left}${right}`)
    .replace(/\s+(?=(?:langues?|languages?|centres? d['’ ]int[eé]r[eê]t|certifications?(?:\s+et\s+formations?)?|formations?\s+et\s+certifications?)\s*:)/gi,"\n")
    .replace(/\s+\/\s+(?=mon\s+portfolio|portfolio\s+informatique)/gi,"\n")
    .replace(/\s+(?=\d{1,2}[\/.-]\d{4}\s*(?:[-–—]|à|a)\s*\d{1,2}[\/.-]?\d{0,4})/g,"\n"));
  const extractedSkills:string[]=[];
  const lines=prepared.split(/\r?\n/).flatMap((line)=>{
    const repaired=repairText(normalizeDateRange(line.trim()));
    if(!usefulCvLine(repaired)) return [];
    const split=splitSkillTail(repaired);
    if(split.skills.length) extractedSkills.push(...split.skills);
    // Les compétences détachées sont stockées séparément : ne les réinjecte
    // pas comme une fausse ligne de section, sinon la section suivante
    // (expériences) serait accidentellement basculée dans COMPÉTENCES.
    return [split.main];
  }).filter(usefulCvLine);
  // Les trois premières lignes correspondent généralement au nom, au titre
  // et aux coordonnées. Le texte qui suit avant la première expérience est
  // conservé comme résumé, même si le CV ne possède pas de titre « Profil ».
  const firstDateIndex=lines.findIndex(isDateLine);
  // Si l'extraction PDF commence par une expérience (cas fréquent avec deux
  // colonnes), ne transforme jamais cette date en nom ou coordonnées.
  let headerCount=firstDateIndex===0 ? 0 : Math.min(3, firstDateIndex>0 ? firstDateIndex : lines.length);
  // Un résumé peut apparaître juste après le nom et le titre, avant les
  // coordonnées. Il ne doit jamais être absorbé dans l'en-tête.
  while(headerCount>1 && /^(profil|r[eé]sum[eé]|summary|objectif)\s*:/i.test(lines[headerCount-1])) headerCount--;
  const header=lines.slice(0,headerCount);
  const sections=new Map<string,string[]>(); let current="PROFIL";
  for(const line of lines.slice(header.length)) {
    const portfolio=line.match(/^(.*?)(?:\/?\s*)mon\s+portfolio\s+informatique\s*:\s*(.+)$/i);
    if(portfolio) {
      const before=portfolio[1].trim();
      if(before) sections.set(current,[...(sections.get(current)??[]),before]);
      current="COMPÉTENCES";
      sections.set(current,[...(sections.get(current)??[]),portfolio[2].trim()]);
      continue;
    }
    const inline=inlineSection(line);
    if(inline){current=inline.name; sections.set(current,[...(sections.get(current)??[]),inline.content]); continue;}
    const next=canonicalSection(line);
    if(next){current=next; if(!sections.has(current)) sections.set(current,[]); continue;}
    // Une ligne de date doit d'abord changer de rubrique. Sinon un diplôme
    // riche en virgules est pris à tort pour une liste de compétences.
    if(isDateLine(line)) {
      if(looksLikeEducationLine(line)) current="FORMATION";
      else if(current==="PROFIL") current="EXPÉRIENCE";
      sections.set(current,[...(sections.get(current)??[]),line]);
      continue;
    }
    if(current==="EXPÉRIENCE" && looksLikeSkillInventory(line)) {
      sections.set("COMPÉTENCES",[...(sections.get("COMPÉTENCES")??[]),line]);
      continue;
    }
    // Beaucoup de CV commencent directement les expériences par une plage de
    // dates sans titre de section : bascule alors du résumé vers l'expérience.
    if(current==="PROFIL" && isDateLine(line)) current="EXPÉRIENCE";
    sections.set(current,[...(sections.get(current)??[]),line]);
  }
  // Recompose toujours le document dans l'ordre attendu par un recruteur :
  // titre/coordonnées, résumé, compétences, expériences, puis formation et
  // certifications. Cela évite que le résumé se retrouve en fin de CV.
  const profileItems = sections.get("PROFIL") ?? [];
  const skillItems = [...(sections.get("COMPÉTENCES") ?? []), ...extractedSkills];
  const experienceItems = sections.get("EXPÉRIENCE") ?? [];
  const educationItems = sections.get("FORMATION") ?? [];
  const languageItems = sections.get("LANGUES")?.length
    ? sections.get("LANGUES")!
    : lines.filter((line)=>{
      const matches=line.match(/\b(?:fran[cç]ais|anglais|espagnol|allemand|italien|arabe|portugais)\b/gi) ?? [];
      return matches.length>=2 || /\b(?:fran[cç]ais|anglais|espagnol|allemand|italien|arabe|portugais)\b\s*[:—-]/i.test(line);
    });
  const interestItems = sections.get("CENTRES D'INTÉRÊT") ?? [];
  const output=[...header,"",...(target?["TITRE CIBLE",target,""]:[])];
  output.push("PROFIL", buildSummary(target, profileItems, experienceItems, skillItems, educationItems), "");
  // Les termes de l'offre ne sont pas des compétences du candidat. Seules les
  // compétences explicitement présentes dans le CV ou confirmées par le
  // parseur de l'offre peuvent apparaître ici.
  const skills=[...new Set([...skillItems,...matchedSkills])].map(repairText).filter(Boolean);
  output.push("COMPÉTENCES", ...(skills.length ? skills : ["Compétences présentes dans le CV à vérifier"]), "");
  // Sépare chaque expérience dès qu'une nouvelle plage de dates apparaît.
  // Cette règle rétablit les retours à la ligne perdus par certains PDF.
  const spacedExperiences=experienceItems.flatMap((item,index)=>[
    ...(index>0 && isDateLine(item) ? [""] : []),
    item,
  ]);
  if (spacedExperiences.length) output.push("EXPÉRIENCE", ...spacedExperiences, "");
  if (educationItems.length) output.push("FORMATION / CERTIFICATIONS", ...educationItems, "");
  if (languageItems.length) output.push("LANGUES", ...languageItems, "");
  if (interestItems.length) output.push("CENTRES D'INTÉRÊT", ...interestItems, "");
  return output.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

export interface ResumeATS {
  header:{fullName:string;targetTitle:string;email:string;phone:string;location:string;linkedinUrl?:string;mobility?:string};
  summary:string;
  skills:{category:string;items:string[]}[];
  experiences:{jobTitle:string;company:string;location:string;startDate:string;endDate:string;bulletPoints:string[]}[];
  education:{degree:string;institution:string;location:string;startYear:string;endYear:string}[];
  languages?:{language:string;proficiency:string}[];
  projects?:{title:string;description:string;technologies:string[]}[];
};

function chronologyValue(value:string) {
  const text=normalize(value);
  if(/present|actuel|aujourd'hui/.test(text)) return Number.MAX_SAFE_INTEGER;
  const year=text.match(/(?:19|20)\d{2}/)?.[0];
  if(!year) return -1;
  const monthNames=["jan","fev","mar","avr","mai","juin","juil","aou","sep","oct","nov","dec","feb","apr","may","jun","jul","aug","sept","oct","nov","dec"];
  const month=monthNames.findIndex((name)=>text.includes(name));
  return Number(year)*100+(month<0?0:(month%12)+1);
}
function sortExperiences(items:ResumeATS["experiences"]) {
  return items.map((item,index)=>({item,index})).sort((a,b)=>{
    const av=chronologyValue(a.item.endDate||a.item.startDate), bv=chronologyValue(b.item.endDate||b.item.startDate);
    return bv-av || a.index-b.index;
  }).map(({item})=>item);
}
function sortEducation(items:ResumeATS["education"]) {
  return items.map((item,index)=>({item,index})).sort((a,b)=>chronologyValue(b.item.endYear||b.item.startYear)-chronologyValue(a.item.endYear||a.item.startYear)||a.index-b.index).map(({item})=>item);
}
function formatStructuredAdaptation(result:ResumeATS) {
  const header=result.header; const contact=[header.email,header.phone,header.location,header.linkedinUrl,header.mobility].filter(Boolean).join(" | ");
  const lines=[header.fullName,header.targetTitle,contact,"","PROFIL",result.summary.trim(),""];
  if(result.skills.length) lines.push("COMPÉTENCES",...result.skills.flatMap((group)=>[`${group.category}:`,...group.items.map((item)=>`- ${item}`),""]));
  const experiences=sortExperiences(result.experiences);
  if(experiences.length) lines.push("EXPÉRIENCE",...experiences.flatMap((experience)=>[`${experience.jobTitle} | ${experience.company} | ${experience.location} | ${experience.startDate} - ${experience.endDate}`,...experience.bulletPoints.map((item)=>`- ${item}`),""]));
  const education=sortEducation(result.education);
  if(education.length) lines.push("FORMATION",...education.map((item)=>`${item.degree} | ${item.institution} | ${item.location} | ${item.startYear} - ${item.endYear}`),"");
  if(result.languages?.length) lines.push("LANGUES",...result.languages.map((item)=>`${item.language}: ${item.proficiency}`),"");
  if(result.projects?.length) lines.push("PROJETS",...result.projects.flatMap((item)=>[item.title,item.description,`Technologies: ${item.technologies.join(", ")}`,""]));
  return lines.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

function parseResumeATS(value:unknown):ResumeATS|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const item=value as Record<string,unknown>; const header=item.header as Record<string,unknown>;
  const text=(entry:unknown)=>typeof entry==="string"?entry.trim():"";
  const strings=(entry:unknown)=>Array.isArray(entry)&&entry.every((value)=>typeof value==="string")?(entry as string[]).map((value)=>value.trim()).filter(Boolean):null;
  if(!header||typeof header!=="object"||Array.isArray(header)||!text(header.fullName)||!text(header.targetTitle)||!text(item.summary))return null;
  if(!Array.isArray(item.skills)||!Array.isArray(item.experiences)||!Array.isArray(item.education))return null;
  const skills=item.skills.map((entry)=>{const group=entry as Record<string,unknown>;const items=strings(group.items);return items&&text(group.category)?{category:text(group.category),items}:null;}).filter(Boolean) as ResumeATS["skills"];
  const experiences=item.experiences.map((entry)=>{const value=entry as Record<string,unknown>;const bulletPoints=strings(value.bulletPoints);return bulletPoints?{jobTitle:text(value.jobTitle),company:text(value.company),location:text(value.location),startDate:text(value.startDate),endDate:text(value.endDate),bulletPoints}:null;}).filter(Boolean) as ResumeATS["experiences"];
  const education=item.education.map((entry)=>{const value=entry as Record<string,unknown>;return {degree:text(value.degree),institution:text(value.institution),location:text(value.location),startYear:text(value.startYear),endYear:text(value.endYear)};});
  const languages=Array.isArray(item.languages)?item.languages.map((entry)=>{const value=entry as Record<string,unknown>;return {language:text(value.language),proficiency:text(value.proficiency)};}).filter((value)=>value.language):undefined;
  const projects=Array.isArray(item.projects)?item.projects.map((entry)=>{const value=entry as Record<string,unknown>;return {title:text(value.title),description:text(value.description),technologies:strings(value.technologies)??[]};}).filter((value)=>value.title||value.description):undefined;
  return {header:{fullName:text(header.fullName),targetTitle:text(header.targetTitle),email:text(header.email),phone:text(header.phone),location:text(header.location),linkedinUrl:text(header.linkedinUrl)||undefined,mobility:text(header.mobility)||undefined},summary:text(item.summary),skills,experiences,education,languages,projects};
}

function cleanStructuredResume(result:ResumeATS):ResumeATS {
  const recoveredSkills:string[]=[];
  const experiences=result.experiences.map((experience)=>({
    ...experience,
    bulletPoints:experience.bulletPoints.flatMap((bullet)=>{
      const split=splitSkillTail(repairText(bullet));
      if(split.skills.length) recoveredSkills.push(...split.skills);
      return split.main ? [split.main] : [];
    }),
  }));
  const skills=result.skills.map((group)=>({category:repairText(group.category),items:group.items.map(repairText).filter(Boolean)}));
  if(recoveredSkills.length) {
    const existing=skills.find((group)=>/tech|outil|langage|data|comp[eé]tence/i.test(group.category));
    if(existing) existing.items=[...new Set([...existing.items,...recoveredSkills])];
    else skills.push({category:"Compétences techniques",items:[...new Set(recoveredSkills)]});
  }
  return {
    ...result,
    header:{...result.header,fullName:repairText(result.header.fullName),targetTitle:repairText(result.header.targetTitle),email:repairText(result.header.email),phone:repairText(result.header.phone),location:repairText(result.header.location),linkedinUrl:result.header.linkedinUrl?repairText(result.header.linkedinUrl):undefined,mobility:result.header.mobility?repairText(result.header.mobility):undefined},
    summary:repairText(result.summary),
    skills:skills.filter((group)=>group.category&&group.items.length),
    experiences,
    education:result.education.map((item)=>({...item,degree:repairText(item.degree),institution:repairText(item.institution),location:repairText(item.location),startYear:repairText(item.startYear),endYear:repairText(item.endYear)})),
    languages:result.languages?.map((item)=>({language:repairText(item.language),proficiency:repairText(item.proficiency)})),
    projects:result.projects?.map((item)=>({...item,title:repairText(item.title),description:repairText(item.description),technologies:item.technologies.map(repairText)})),
  };
}

async function adaptWithQwen(offer: string, cv: string, keywordHints: string[] = []): Promise<{ text: string; structured: ResumeATS } | null> {
  const base = String(process.env.AI_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return null;
  const model = String(process.env.AI_MODEL ?? "Qwen/Qwen3-8B").trim();
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const endpoint = `${base}${base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response:Response;
  const systemPrompt = `Tu es une API de parsing de CV ultra-rigoureuse, experte en recrutement multi-secteurs et en architectures ATS (Applicant Tracking Systems). Tu traites aussi bien les métiers techniques que les fonctions administratives, commerciales, juridiques, financières, RH, marketing, logistiques, industrielles, médicales, éducatives, hôtelières et de service.

OBJECTIF : convertir le texte brut d'un CV, éventuellement bruité par un OCR ou une extraction PDF/DOCX, en un objet JSON ResumeATS propre, hiérarchisé et fidèle aux seules données source.

ALGORITHME DE NETTOYAGE (À APPLIQUER À TOUT LE TEXTE) :
1. Corrige les entités HTML et les mauvaises conversions UTF-8 lorsque le contexte permet de retrouver le caractère original (par exemple dâ experience → d'expérience, â€ → -, &amp; → &).
2. Supprime les puces décoratives/exotiques (emoji, •, ▪, ✈, ➢, espaces insécables), déduplique les espaces et répare les retours à la ligne au milieu d'une phrase.
3. Si une suite de technologies est artificiellement collée à une phrase d'expérience, retire cette pollution de la puce et place les compétences uniquement dans skills lorsqu'elles sont réellement présentes dans le CV.
4. Trie expériences et formations en ordre chronologique inverse. Vérifie les dates et corrige seulement leur ordre (par exemple 2024-2022 devient 2022-2024), sans inventer de date.
5. ALIGNEMENT ATS : repère les termes importants de l'offre et réutilise leur formulation exacte dans le titre, le résumé, les compétences et les puces lorsqu'une compétence équivalente est explicitement démontrée dans le CV. Un synonyme n'est autorisé que s'il décrit exactement une compétence déjà présente. N'ajoute jamais une technologie, une mission ou un niveau simplement parce qu'il figure dans l'offre.

RÈGLES DE MAPPING :
- header : extrais uniquement le nom, le titre visé, l'email, le téléphone, la localisation et les liens réellement présents. Utilise linkedinUrl pour LinkedIn et mobility si elle est explicitement fournie.
- summary : place uniquement l'accroche globale ici, jamais dans une expérience. Si elle manque, retourne une chaîne vide.
- experiences : conserve les intitulés et entreprises exacts, sépare la localisation, utilise MM/YYYY, YYYY ou Présent, et formule des puces Action + contexte + résultat. N'ajoute une métrique que si elle apparaît dans le CV.
- skills : regroupe toutes les compétences réellement présentes, techniques ou métier, dans des catégories adaptées au CV (par exemple Outils, Méthodes, Gestion, Vente & relation client, Droit & conformité, Finance, Industrie, Santé, Langues, Informatique). Ne force jamais une catégorie Tech/Data si elle ne correspond pas au profil.
- education : conserve les diplômes, établissements, lieux et années réellement présents ; intègre aussi les certifications dans cette section avec leur intitulé et organisme lorsque ces informations figurent dans le CV.

RÈGLE ABSOLUE ANTI-HALLUCINATION : n'invente aucune donnée (nom, date, compétence, responsabilité, entreprise, diplôme ou résultat). Ne duplique aucun mot-clé sans lien avec le contenu source.

FORMAT DE SORTIE STRICT : retourne uniquement un objet JSON valide conforme à ResumeATS, avec les clés header, summary, skills, experiences, education, languages et projects. Les champs obligatoires doivent toujours exister ; pour une donnée absente, utilise une chaîne vide ou un tableau vide. Aucun texte explicatif et aucun bloc Markdown.`;
  try {
    const keywordHintText = keywordHints.length
      ? keywordHints.join(", ")
      : "Aucun terme fiable extrait automatiquement.";
    response = await fetch(endpoint, { signal:controller.signal, method:"POST", headers:{"content-type":"application/json", ...(apiKey?{authorization:`Bearer ${apiKey}`}:{})}, body:JSON.stringify({ model, temperature:0.1, max_tokens:3000, response_format:{type:"json_object"}, messages:[{role:"system",content:systemPrompt},{role:"user",content:`### TERMES CLÉS EXTRAITS DE L'OFFRE ###\n${keywordHintText}\n\nUtilise ces formulations dans le CV uniquement lorsqu'elles correspondent à une compétence ou une expérience explicitement démontrée dans le CV source. N'ajoute jamais un terme simplement parce qu'il figure dans cette liste.\n\n### OFFRE D'EMPLOI ###\n${offer}\n\n### CV À OPTIMISER ###\n${cv}\n\nRetourne uniquement un objet JSON conforme au modèle ResumeATS avec les clés header, summary, skills, experiences, education, languages et projects.`}]}) });
  } finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as {choices?:Array<{message?:{content?:string}}>};
  const raw = String(data.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let structured: ResumeATS|null;
  try { structured = parseResumeATS(JSON.parse(raw)); } catch { return null; }
  if(!structured) return null;
  structured = cleanStructuredResume(structured);
  const content = formatStructuredAdaptation(structured);
  const normalized=normalize(content);
  const headings=["experience","formation","competences","profil"].filter((heading)=>normalized.includes(heading));
  const containsTemplateText=/resumez vos|utilisez la langue|soyez concis|exemple de cv|a completer|placeholder|je ne peux/i.test(normalized);
  // A model can return the input unchanged while still satisfying the basic
  // heading checks. Treat that as a failed adaptation and use the deterministic
  // fallback instead of presenting a false positive to the user.
  const unchanged = compact(content) === compact(cv) || (compact(content).length > 0 && compact(cv).includes(compact(content)) && compact(content).length / compact(cv).length > 0.96);
  // Ne jamais afficher une réponse IA réduite au seul en-tête/résumé : si le
  // CV source contient des expériences, compétences ou formations, ces blocs
  // doivent aussi exister dans la sortie. Sinon on repasse au moteur local,
  // qui conserve intégralement le contenu lisible extrait du fichier.
  const sourceNormalized = normalize(cv);
  const sourceHasExperience = /exp[eé]rience|parcours professionnel|professional experience|emploi/.test(sourceNormalized);
  const sourceHasSkills = /comp[eé]tence|skills|savoir[- ]faire|expertise/.test(sourceNormalized);
  const sourceHasEducation = /formation|education|[eé]tudes|dipl[oô]me/.test(sourceNormalized);
  const missingMajorSection = (sourceHasExperience && structured.experiences.length === 0)
    || (sourceHasSkills && structured.skills.length === 0)
    || (sourceHasEducation && structured.education.length === 0);
  const tooSparse = content.length < Math.max(240, Math.round(cv.length * 0.35));
  return content.length >= 120 && headings.length >= 2 && !containsTemplateText && !unchanged && !missingMajorSection && !tooSparse ? {text:content, structured} : null;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({ error: "Compte suspendu" }, { status: 403 });
  if (!await enforceRateLimit(user.email, "cv-adapt", 8, 3600)) return Response.json({ error: "Limite d’adaptations atteinte pour cette heure" }, { status: 429 });
  try {
    const body = await request.json().catch(() => ({})) as { offer?: string; cv?: string };
    const offer = String(body.offer ?? "").trim().slice(0, 30000);
    const cv = String(body.cv ?? "").trim().slice(0, 50000);
    if (offer.length < 40 || cv.length < 80) return Response.json({ error: "Saisissez une annonce et un CV suffisamment détaillés." }, { status: 400 });
    let modelAdapted = null;
    const parsedForKeywords = normalize(offer).split(/[^a-z0-9+#.]+/).filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
    const keywordHints = [...new Set(parsedForKeywords)].slice(0, 80);
    try { modelAdapted = await adaptWithQwen(offer, cv, keywordHints); } catch { modelAdapted = null; }
    let parsed;
    try { parsed = parseOfferText(offer); } catch { parsed = { role: "", requiredSkills: "" }; }
    const cvNormalized = normalize(cv);
    const requested = String(parsed.requiredSkills ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const offerTerms = normalize(offer).split(/[^a-z0-9+#.]+/).filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
    const keywords = [...new Set([...requested.map(normalize), ...offerTerms])].slice(0, 80);
    const matchedKeywords = keywords.filter((keyword) => cvNormalized.includes(keyword));
    const matchedSkills = requested.filter((skill) => cvNormalized.includes(normalize(skill)));
    const target = String(parsed.role ?? "").trim();
    const adapted = buildLocalAdaptation(cv,target,matchedSkills,matchedKeywords);
    const provider = modelAdapted ? "Qwen3-8B" : "moteur local";
    const candidate = modelAdapted?.text ?? adapted;
    // Une adaptation ne doit jamais être quasi vide par rapport au CV fourni.
    // Le repli conserve alors la structure locale complète ; en dernier recours
    // le texte extrait est conservé plutôt que de perdre des expériences.
    const minimumUsefulLength = Math.max(240, Math.round(cv.length * 0.35));
    const adaptedCv = candidate.length >= minimumUsefulLength
      ? candidate
      : adapted.length >= minimumUsefulLength
        ? adapted
        : [target ? `PROFIL CIBLE\n${target}` : "", "CV SOURCE", cv].filter(Boolean).join("\n\n");
    await recordActivity(user, "cv.adapted", `CV adapté pour ${target || "une offre"} (${provider})`);
    return Response.json({ ok: true, adaptedCv, structured: modelAdapted?.structured ?? null, matchedSkills, matchedKeywords, targetRole: target, provider, quality: qualityReport(cv, adaptedCv, matchedKeywords), note: "Le contenu est réorganisé et priorisé à partir de votre CV. Vérifiez chaque formulation avant envoi : Fala AI n'invente aucune expérience." });
  } catch (error) {
    try { await logSystemError("/api/cv/adapt", error, user.email); } catch { /* journalisation best-effort */ }
    return Response.json({ error: "Adaptation du CV momentanément indisponible" }, { status: 500 });
  }
}
