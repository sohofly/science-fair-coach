(function(){
  const cfg=window.SFC_CONFIG||{};const tokenKey='sfcStudentToken',researchKey='sfcResearchId';
  const enabled=()=>Boolean(cfg.supabaseUrl&&cfg.supabaseAnonKey&&localStorage.getItem(tokenKey));
  async function call(body){if(!enabled())return null;const response=await fetch(`${cfg.supabaseUrl}/functions/v1/student-api`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'x-student-token':localStorage.getItem(tokenKey)},body:JSON.stringify(body)});if(!response.ok)throw new Error((await response.json()).error||'後端同步失敗');return response.json()}
  const researchId=()=>localStorage.getItem(researchKey)||'';const setResearchId=id=>id?localStorage.setItem(researchKey,id):localStorage.removeItem(researchKey);
  async function track(eventType,content={},extra={}){try{return await call({action:'event',researchId:researchId(),eventType,content,...extra})}catch(error){console.warn(error.message);return null}}
  async function recommend(profile,answers=[]){if(!enabled())throw new Error('尚未連接班級後端');const response=await fetch(`${cfg.supabaseUrl}/functions/v1/recommend-topics`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'x-student-token':localStorage.getItem(tokenKey)},body:JSON.stringify({profile,answers,researchId:researchId()})});const data=await response.json();if(!response.ok)throw new Error(data.error||'動態推薦失敗');return data.result}
  async function reviewExperiment(payload){if(!enabled())return null;const response=await fetch(`${cfg.supabaseUrl}/functions/v1/experiment-review`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'x-student-token':localStorage.getItem(tokenKey)},body:JSON.stringify({...payload,researchId:researchId()})});const data=await response.json();if(!response.ok)throw new Error(data.error||'實驗紀錄分析失敗');return data}
  async function savePlan(plan){return call({action:'save_plan',researchId:researchId(),plan})}
  async function decideSuggestion(suggestionId,decision){return call({action:'decide_plan_suggestion',suggestionId,decision})}
  async function saveReflection(reflection){return call({action:'event',researchId:researchId(),eventType:'reflection_added',content:reflection})}
  async function createProject(title){const data=await call({action:'create_project',title});setResearchId(data.project.id);return data.project}
  window.ScienceFairBackend={enabled,track,recommend,reviewExperiment,savePlan,decideSuggestion,saveReflection,createProject,get:(id=researchId())=>call({action:'get',researchId:id}),setResearchId,researchId,setToken:token=>localStorage.setItem(tokenKey,token),clear:()=>{localStorage.removeItem(tokenKey);localStorage.removeItem(researchKey)}};
})();
