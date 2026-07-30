export const SCORE_WEIGHTS = {
  skills: 35,
  title: 15,
  experience: 15,
  location: 10,
  education: 10,
  contract: 5,
  languages: 5,
  salary: 5,
} as const;

export const MATCHING_CONFIG = { weights: SCORE_WEIGHTS, dealbreakers: ["location", "salary", "contract"] as const } as const;
export const EDUCATION_LEVELS = ["Bac","Bac+1","Bac+2","Bac+3","Bac+4","Bac+5","Bac+6","Bac+7","Bac+8 et plus"] as const;
export type ScoringProfile = { target_title:string; location:string; contract_type:string; skills:string; experience_level:string; education_level:string; languages:string; sectors:string; salary_min:number };
type ApplicationInput = Record<string, unknown>;
type CriteriaKey = keyof typeof SCORE_WEIGHTS;
type Breakdown = Record<CriteriaKey,{rawScore:number;weightedScore:number}>;

const EXPERIENCE_RANK:Record<string,number> = {"Débutant":0,"1-3 ans":1,"3-5 ans":2,"5+ ans":3};
function normalize(value:unknown){return String(value??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function tokens(value:unknown){return normalize(value).split(/[,;/|]+/).map((item)=>item.trim()).filter(Boolean);}
function valueFrom(body:ApplicationInput,camel:string,snake:string){return body[camel]??body[snake]??"";}
function overlapRatio(wanted:unknown,available:unknown){const expected=tokens(wanted),actual=tokens(available);if(!expected.length||!actual.length)return expected.length?0:1;return expected.filter((item)=>actual.some((candidate)=>candidate===item||candidate.includes(item)||item.includes(candidate))).length/expected.length;}
function titleScore(profile:string,offer:string){if(!profile||!offer)return 1;const a=new Set(tokens(profile.replace(/[\-_/]/g," "))),b=tokens(offer.replace(/[\-_/]/g," "));if(!a.size||!b.length)return 1;return b.filter((item)=>[...a].some((candidate)=>candidate.includes(item)||item.includes(candidate))).length/b.length;}
function educationRank(value:unknown){const text=normalize(value);if(!text)return -1;if(text.includes("doctorat"))return 8;if(text==="bac")return 0;const match=text.match(/bac\s*\+\s*(\d+)/);return match?Math.min(8,Number(match[1])):-1;}
function experienceRank(value:unknown){const text=String(value??"").trim();if(text in EXPERIENCE_RANK)return EXPERIENCE_RANK[text];const match=text.match(/(\d+)/);return match?Number(match[1])>=5?3:Number(match[1])>=3?2:Number(match[1])>=1?1:0:-1;}
function compareExperience(profile:unknown,required:unknown){const needed=experienceRank(required),available=experienceRank(profile);return needed<0||available<0?1:available>=needed?1:0.6;}
function compareEducation(profile:unknown,required:unknown){const needed=educationRank(required),available=educationRank(profile);return needed<0||available<0?1:available>=needed?1:0;}
function compareLocation(profile:unknown,offer:unknown,relocate=false,remotePolicy:string=""){const a=normalize(profile),b=normalize(offer);if(!a||!b||remotePolicy==="full"||b.includes("remote")||b.includes("teletravail")||relocate)return 1;return a.includes(b)||b.includes(a)?1:0;}
function compareContract(profile:unknown,offer:unknown){const a=normalize(profile),b=normalize(offer);return !a||!b||a===b?1:0;}
function compareLanguages(profile:unknown,offer:unknown){return overlapRatio(profile,offer);}
function compareSalary(candidateMin:number,offerMax:number){if(!candidateMin||!offerMax)return 1;if(candidateMin<=offerMax)return 1;const gap=(candidateMin-offerMax)/offerMax;return gap<=0.1?0.5:0;}
function formatBreakdown(raw:Record<CriteriaKey,number>):Breakdown{return Object.fromEntries(Object.entries(SCORE_WEIGHTS).map(([key,weight])=>{const value=Math.max(0,Math.min(1,raw[key as CriteriaKey]??0));return [key,{rawScore:Math.round(value*100),weightedScore:Number((value*weight).toFixed(2))}];})) as Breakdown;}
function emptyBreakdown(){return formatBreakdown({skills:0,title:0,experience:0,location:0,education:0,contract:0,languages:0,salary:0});}

export function calculateScore(profile:ScoringProfile|null,body:ApplicationInput){
  if(!profile)return {score:null,breakdown:null,isDealbroken:false};
  const offerLocation=String(valueFrom(body,"location","location")??"");
  const offerSalary=Math.max(0,Number(valueFrom(body,"salaryMax","salary_min"))||0);
  const raw:Record<CriteriaKey,number>={
    skills:overlapRatio(profile.skills,valueFrom(body,"requiredSkills","required_skills")),
    title:titleScore(profile.target_title,String(valueFrom(body,"role","role")??"")),
    experience:compareExperience(profile.experience_level,valueFrom(body,"experienceRequired","experience_required")),
    location:compareLocation(profile.location,offerLocation,false,offerLocation),
    education:compareEducation(profile.education_level,valueFrom(body,"educationRequired","education_required")),
    contract:compareContract(profile.contract_type,valueFrom(body,"contractType","contract_type")),
    languages:compareLanguages(profile.languages,valueFrom(body,"languages","languages")),
    salary:compareSalary(Number(profile.salary_min)||0,offerSalary),
  };
  for(const criterion of MATCHING_CONFIG.dealbreakers){if(raw[criterion]===0)return {score:0,isDealbroken:true,dealbreakerReason:`Incompatibilité critique sur le critère : ${criterion}`,breakdown:formatBreakdown(raw)};}
  const score=Math.round(Object.entries(SCORE_WEIGHTS).reduce((sum,[key,weight])=>sum+(raw[key as CriteriaKey]??0)*weight,0));
  return {score:Math.max(0,Math.min(100,score)),isDealbroken:false,breakdown:formatBreakdown(raw)};
}

function aiEndpoint(){const base=String(process.env.AI_BASE_URL??"").trim().replace(/\/$/,"");return base?`${base}${base.endsWith("/v1")?"/chat/completions":"/v1/chat/completions"}`:"";}
export async function calculateScoreWithAI(profile:ScoringProfile|null,body:ApplicationInput){
  const fallback=calculateScore(profile,body);const endpoint=aiEndpoint();if(!profile||!endpoint||fallback.isDealbroken)return fallback;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(endpoint,{signal:controller.signal,method:"POST",headers:{"content-type":"application/json",...(process.env.AI_API_KEY?{authorization:`Bearer ${process.env.AI_API_KEY}`}:{})},body:JSON.stringify({model:String(process.env.AI_MODEL??"llama-3.1-8b-instant"),temperature:0,max_tokens:300,response_format:{type:"json_object"},messages:[{role:"system",content:`Évalue la compatibilité entre ce profil et cette offre. Réponds uniquement en JSON avec les critères ${Object.keys(SCORE_WEIGHTS).join(",")}. Chaque valeur est entre 0 et son poids maximal ${JSON.stringify(SCORE_WEIGHTS)}. N'invente aucune information.`},{role:"user",content:JSON.stringify({profile,offer:body})}]})});if(!response.ok)return fallback;const payload=await response.json().catch(()=>({})) as {choices?:Array<{message?:{content?:string}}>};const raw=String(payload.choices?.[0]?.message?.content??"").replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();const parsed=JSON.parse(raw) as Record<string,unknown>;const aiBreakdown=Object.fromEntries(Object.entries(SCORE_WEIGHTS).map(([key,weight])=>[key,Math.max(0,Math.min(weight,Math.round(Number(parsed[key])||0)))])) as Record<CriteriaKey,number>;return {score:Object.values(aiBreakdown).reduce((sum,value)=>sum+value,0),breakdown:aiBreakdown};}catch{return fallback;}finally{clearTimeout(timeout);}
}
