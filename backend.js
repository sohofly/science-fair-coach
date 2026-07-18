(function(){
  const cfg=window.SFC_CONFIG||{};const tokenKey='sfcStudentToken';
  const enabled=()=>Boolean(cfg.supabaseUrl&&cfg.supabaseAnonKey&&localStorage.getItem(tokenKey));
  async function call(body){if(!enabled())return null;const response=await fetch(`${cfg.supabaseUrl}/functions/v1/student-api`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'x-student-token':localStorage.getItem(tokenKey)},body:JSON.stringify(body)});if(!response.ok)throw new Error((await response.json()).error||'後端同步失敗');return response.json()}
  async function track(eventType,content={},extra={}){try{return await call({action:'event',eventType,content,...extra})}catch(error){console.warn(error.message);return null}}
  async function recommend(profile,answers=[]){if(!enabled())throw new Error('尚未連接班級後端');const response=await fetch(`${cfg.supabaseUrl}/functions/v1/recommend-topics`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'x-student-token':localStorage.getItem(tokenKey)},body:JSON.stringify({profile,answers})});const data=await response.json();if(!response.ok)throw new Error(data.error||'動態推薦失敗');return data.result}
  window.ScienceFairBackend={enabled,track,recommend,get:()=>call({action:'get'}),setToken:token=>localStorage.setItem(tokenKey,token),clear:()=>localStorage.removeItem(tokenKey)};
})();
