import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsHeaders,json} from '../_shared/cors.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const enc=new TextEncoder();
async function sha(value:string){const bytes=await crypto.subtle.digest('SHA-256',enc.encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hashPin(pin:string,salt=randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',16)){const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:120000,hash:'SHA-256'},key,256);return `${salt}:${hex(bits)}`}
async function verifyPin(pin:string,stored:string){const [salt]=stored.split(':');return !!salt&&(await hashPin(pin,salt))===stored}
function randomFrom(chars:string,n:number){const bytes=crypto.getRandomValues(new Uint8Array(n));return [...bytes].map(x=>chars[x%chars.length]).join('')}
function identity(){const animals=['藍鯨','雲豹','水獺','山羌','石虎','海豚','角鴞','穿山甲'];return `${animals[crypto.getRandomValues(new Uint8Array(1))[0]%animals.length]}-${randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',4)}`}
async function sessionStudent(req:Request){const token=req.headers.get('x-student-token');if(!token)return null;const hash=await sha(token);const {data}=await db.from('student_sessions').select('id,student_id,expires_at,students(*)').eq('token_hash',hash).gt('expires_at',new Date().toISOString()).maybeSingle();if(!data)return null;await db.from('student_sessions').update({last_seen_at:new Date().toISOString()}).eq('id',data.id);return data.students}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const body=await req.json();const action=body.action;
    if(action==='join'){
      const classCode=String(body.classCode||'').toUpperCase().trim();
      const loginEmail=String(body.loginEmail||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail))return json({error:'請輸入有效的學生 Email'},400);
      const password=String(body.password||'');if(password.length<6||password.length>72)return json({error:'密碼至少需要 6 個字元'},400);
      const attemptKey=await sha(`join:${req.headers.get('x-forwarded-for')||'unknown'}:${classCode}`);const since=new Date(Date.now()-15*60*1000).toISOString();const {count}=await db.from('student_login_attempts').select('*',{count:'exact',head:true}).eq('attempt_key',attemptKey).gte('attempted_at',since);if((count||0)>=20)return json({error:'建立次數過多，請15分鐘後再試'},429);await db.from('student_login_attempts').insert({attempt_key:attemptKey});
      const {data:klass}=await db.from('classes').select('id,name').eq('join_code',classCode).maybeSingle();
      if(!klass)return json({error:'班級加入碼不存在'},404);
      const {data:existingEmail}=await db.from('students').select('id').eq('login_email',loginEmail).gt('delete_after',new Date().toISOString()).limit(1).maybeSingle();if(existingEmail)return json({error:'這個 Email 已有學生帳號，請直接登入'},409);
      let code=identity();
      for(let tries=0;tries<5;tries++){
        const {data,error}=await db.from('students').insert({class_id:klass.id,student_code:code,login_email:loginEmail,pin_hash:await hashPin(password)}).select().single();
        if(!error&&data){const {data:project}=await db.from('research_projects').insert({student_id:data.id,title:'第一個研究歷程'}).select().single();const token=crypto.randomUUID()+crypto.randomUUID();await db.from('student_sessions').insert({student_id:data.id,token_hash:await sha(token)});await db.from('thought_events').insert({student_id:data.id,research_id:project.id,event_type:'joined',content:{class_name:klass.name},source:'system'});return json({student:{...data,pin_hash:undefined,class_name:klass.name},project,token});}
        code=identity();
      }
      return json({error:'暫時無法建立學生代號'},500);
    }
    if(action==='list_students'){
      const classCode=String(body.classCode||'').toUpperCase().trim();
      const attemptKey=await sha(`list:${req.headers.get('x-forwarded-for')||'unknown'}:${classCode}`);const since=new Date(Date.now()-15*60*1000).toISOString();
      const {count}=await db.from('student_login_attempts').select('*',{count:'exact',head:true}).eq('attempt_key',attemptKey).gte('attempted_at',since);if((count||0)>=30)return json({error:'查詢次數過多，請15分鐘後再試'},429);
      await db.from('student_login_attempts').insert({attempt_key:attemptKey});
      const {data:klass}=await db.from('classes').select('id').eq('join_code',classCode).maybeSingle();if(!klass)return json({error:'班級加入碼不存在'},404);
      const {data,error}=await db.from('students').select('student_code').eq('class_id',klass.id).gt('delete_after',new Date().toISOString()).order('created_at');if(error)throw error;
      return json({students:data||[]});
    }
    if(action==='resume'){
      const loginEmail=String(body.loginEmail||'').trim().toLowerCase();const password=String(body.password||body.pin||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail))return json({error:'請輸入有效的學生 Email'},400);
      const attemptKey=await sha(`${req.headers.get('x-forwarded-for')||'unknown'}:${loginEmail}`);const since=new Date(Date.now()-15*60*1000).toISOString();
      const {count}=await db.from('student_login_attempts').select('*',{count:'exact',head:true}).eq('attempt_key',attemptKey).gte('attempted_at',since);if((count||0)>=10)return json({error:'嘗試次數過多，請15分鐘後再試'},429);
      const {data:matches}=await db.from('students').select('*,classes!inner(name,join_code)').eq('login_email',loginEmail).gt('delete_after',new Date().toISOString()).limit(2);let data=matches?.length===1?matches[0]:null;
      if(!data){const legacy:any=await sessionStudent(req);if(legacy&&!legacy.login_email&&await verifyPin(password,legacy.pin_hash)){const {data:emailOwner}=await db.from('students').select('id').eq('login_email',loginEmail).limit(1).maybeSingle();if(emailOwner)return json({error:'這個 Email 已被其他學生使用'},409);const {data:updated,error}=await db.from('students').update({login_email:loginEmail}).eq('id',legacy.id).select('*,classes!inner(name,join_code)').single();if(error)return json({error:'無法綁定 Email，請稍後再試'},409);data=updated;}}
      if(!data||!await verifyPin(password,data.pin_hash)){await db.from('student_login_attempts').insert({attempt_key:attemptKey});return json({error:'Email 或密碼不正確'},401);}
      if(new Date(data.delete_after)<=new Date())return json({error:'紀錄已到期'},410);
      const token=crypto.randomUUID()+crypto.randomUUID();await db.from('student_sessions').insert({student_id:data.id,token_hash:await sha(token)});delete data.pin_hash;return json({student:data,token});
    }
    const student:any=await sessionStudent(req);if(!student)return json({error:'學生登入已失效'},401);
    if(action==='get'){const {data:projects}=await db.from('research_projects').select('*').eq('student_id',student.id).order('created_at',{ascending:false});const researchId=String(body.researchId||projects?.[0]?.id||'');const [{data:events},{data:experimentRecords},{data:researchPlan},{data:planSuggestions}]=await Promise.all([db.from('thought_events').select('*').eq('student_id',student.id).eq('research_id',researchId).order('created_at'),db.from('experiment_records').select('id,research_id,record_kind,method,result,file_name,mime_type,ai_review,created_at').eq('student_id',student.id).eq('research_id',researchId).order('created_at'),db.from('research_plans').select('*').eq('student_id',student.id).eq('research_id',researchId).maybeSingle(),db.from('research_plan_suggestions').select('id,research_id,comment,proposed_plan,status,created_at,decided_at').eq('student_id',student.id).eq('research_id',researchId).order('created_at',{ascending:false})]);delete student.pin_hash;return json({student,projects,currentProject:projects?.find((p:any)=>p.id===researchId)||null,events,experimentRecords,researchPlan,planSuggestions,status:new Date(student.active_until)<=new Date()?'read_only':'active'});}
    if(new Date(student.active_until)<=new Date())return json({error:'紀錄已進入唯讀期'},423);
    if(action==='create_project'){const {count}=await db.from('research_projects').select('*',{count:'exact',head:true}).eq('student_id',student.id);if((count||0)>=5)return json({error:'最多只能保存 5 個研究主題，請先匯出並刪除一個舊主題'},409);const title=String(body.title||'新研究歷程').trim().slice(0,200)||'新研究歷程';const {data:project,error}=await db.from('research_projects').insert({student_id:student.id,title}).select().single();if(error)throw error;return json({project});}
    if(action==='delete_project'){const researchId=String(body.researchId||'');const {count}=await db.from('research_projects').select('*',{count:'exact',head:true}).eq('student_id',student.id);if((count||0)<5)return json({error:'研究主題未滿 5 個，目前不能刪除'},409);const {data:project}=await db.from('research_projects').select('id').eq('id',researchId).eq('student_id',student.id).maybeSingle();if(!project)return json({error:'找不到研究主題'},404);const {error}=await db.from('research_projects').delete().eq('id',researchId).eq('student_id',student.id);if(error)throw error;const {data:projects}=await db.from('research_projects').select('*').eq('student_id',student.id).order('created_at',{ascending:false});return json({ok:true,projects:projects||[],nextResearchId:projects?.[0]?.id||null});}
    if(action==='save_plan'){
      const plan=body.plan,researchId=String(body.researchId||'');if(!plan||!researchId||JSON.stringify(plan).length>30000)return json({error:'研究架構內容不正確'},400);
      const {data:project}=await db.from('research_projects').select('id').eq('id',researchId).eq('student_id',student.id).maybeSingle();if(!project)return json({error:'找不到研究歷程'},404);const {data:existing}=await db.from('research_plans').select('research_id').eq('research_id',researchId).maybeSingle();
      if(!existing){const {error}=await db.from('research_plans').insert({student_id:student.id,research_id:researchId,system_plan:plan,current_plan:plan});if(error)throw error;await db.from('thought_events').insert({student_id:student.id,research_id:researchId,event_type:'plan_created',source:'system',content:{plan}});}
      return json({ok:true});
    }
    if(action==='decide_plan_suggestion'){
      const decision=body.decision==='accept'?'accepted':body.decision==='decline'?'declined':'';if(!decision)return json({error:'決定不正確'},400);
      const {data:suggestion}=await db.from('research_plan_suggestions').select('*').eq('id',body.suggestionId).eq('student_id',student.id).eq('status','pending').maybeSingle();if(!suggestion)return json({error:'找不到待處理的教師建議'},404);
      if(decision==='accepted'){const {data:plan}=await db.from('research_plans').select('revision').eq('research_id',suggestion.research_id).single();await db.from('research_plans').update({current_plan:suggestion.proposed_plan,revision:(plan?.revision||1)+1,updated_at:new Date().toISOString()}).eq('research_id',suggestion.research_id);}
      await db.from('research_plan_suggestions').update({status:decision,decided_at:new Date().toISOString()}).eq('id',suggestion.id);
      await db.from('thought_events').insert({student_id:student.id,research_id:suggestion.research_id,event_type:decision==='accepted'?'plan_suggestion_accepted':'plan_suggestion_declined',source:'student',content:{suggestion_id:suggestion.id,comment:suggestion.comment}});
      return json({ok:true,currentPlan:decision==='accepted'?suggestion.proposed_plan:null});
    }
    if(action==='event'){
      const allowed=['division_selected','profile_updated','interest_selected','observation_entered','question_shown','answer_submitted','topics_recommended','topic_selected','topic_rejected','source_opened','plan_created','reflection_added'];const researchId=String(body.researchId||'');const {data:project}=await db.from('research_projects').select('id').eq('id',researchId).eq('student_id',student.id).maybeSingle();if(!project)return json({error:'找不到研究歷程'},404);
      if(!allowed.includes(body.eventType))return json({error:'不允許的紀錄類型'},400);
      if(JSON.stringify(body).length>20000)return json({error:'單次紀錄內容過長'},413);
      const {error}=await db.from('thought_events').insert({student_id:student.id,research_id:researchId,event_type:body.eventType,content:body.content||{},source:body.source==='system'?'system':'student'});if(error)throw error;
      if(body.profile){await db.from('students').update({profile:body.profile}).eq('id',student.id);await db.from('research_projects').update({profile:body.profile,updated_at:new Date().toISOString()}).eq('id',researchId);}
      if(body.selectedTopic){await db.from('students').update({selected_topic:body.selectedTopic}).eq('id',student.id);await db.from('research_projects').update({selected_topic:body.selectedTopic,title:String(body.selectedTopic.title||'研究歷程').slice(0,200),updated_at:new Date().toISOString()}).eq('id',researchId);}
      return json({ok:true});
    }
    return json({error:'未知操作'},400);
  }catch(error){console.error(error);return json({error:'伺服器處理失敗'},500)}
});
