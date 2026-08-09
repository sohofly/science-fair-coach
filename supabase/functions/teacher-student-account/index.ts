import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsHeaders,json} from '../_shared/cors.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,serviceKey);
const enc=new TextEncoder();

function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function randomFrom(chars:string,n:number){const bytes=crypto.getRandomValues(new Uint8Array(n));return [...bytes].map(x=>chars[x%chars.length]).join('')}
async function hashPassword(password:string,salt=randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',16)){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:120000,hash:'SHA-256'},key,256);return `${salt}:${hex(bits)}`}
function identity(){const animals=['藍鯨','雲豹','水獺','山羌','石虎','海豚','角鴞','穿山甲'];return `${animals[crypto.getRandomValues(new Uint8Array(1))[0]%animals.length]}-${randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',4)}`}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const authorization=req.headers.get('authorization')||'';
    if(!authorization.toLowerCase().startsWith('bearer '))return json({error:'教師登入已失效'},401);
    const authClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
    const {data:{user},error:userError}=await authClient.auth.getUser();
    if(userError||!user)return json({error:'教師登入已失效'},401);

    const body=await req.json();
    if(body.action==='ai_plan_suggestion'){
      const researchId=String(body.researchId||'');
      const {data:project}=await db.from('research_projects').select('id,title,profile,selected_topic,student_id,students!inner(class_id,classes!inner(teacher_id))').eq('id',researchId).maybeSingle();
      if(!project||(project.students as any)?.classes?.teacher_id!==user.id)return json({error:'沒有權限查看這個研究歷程'},403);
      const [{data:researchPlan},{data:events}]=await Promise.all([db.from('research_plans').select('current_plan').eq('research_id',researchId).maybeSingle(),db.from('thought_events').select('event_type,content').eq('research_id',researchId).in('event_type',['answer_submitted','reflection_added','experiment_uploaded','experiment_reviewed']).order('created_at').limit(40)]);
      if(!researchPlan?.current_plan)return json({error:'學生尚未建立研究架構'},404);
      const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)return json({error:'AI 服務尚未啟用'},503);
      const schema={type:'object',additionalProperties:false,required:['comment','question','hypothesis','variables','materials','procedure','analysis','safety'],properties:{comment:{type:'string'},question:{type:'string'},hypothesis:{type:'string'},variables:{type:'string'},materials:{type:'string'},procedure:{type:'string'},analysis:{type:'string'},safety:{type:'string'}}};
      const prompt=`你是臺灣國小科展教師的研究架構審查助手。請根據學生自己填寫的題目、條件、對談、心得、實驗紀錄及目前研究架構，提出安全、可執行且適合國小程度的修正版。保留學生原本可行的想法，不可捏造實驗結果、文獻或器材。研究問題需可量測；假設要有方向及理由；變因要明列操縱、應變、控制變因；步驟需可重複並包含合理重複次數；分析需說明表格、單位及比較方法；安全須具體。comment用教師能直接給學生看的語氣，說明最重要的修改理由。\n學生題目：${JSON.stringify(project.selected_topic||project.title)}\n學生條件與對談：${JSON.stringify(project.profile||{})}\n學生近期紀錄：${JSON.stringify(events||[])}\n目前研究架構：${JSON.stringify(researchPlan.current_plan)}`;
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:Deno.env.get('OPENAI_MODEL')||'gpt-5.6',reasoning:{effort:'low'},input:[{role:'developer',content:'只輸出符合 JSON Schema 的繁體中文內容。這是草稿，不得宣稱已寫入資料庫。'},{role:'user',content:prompt}],text:{format:{type:'json_schema',name:'teacher_plan_suggestion',strict:true,schema}}})});
      const result=await response.json();if(!response.ok){console.error(result);return json({error:'AI 暫時無法產生修改建議'},502)}const outputText=result.output_text||result.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==='output_text')?.text;if(!outputText)throw new Error('missing model output');const draft=JSON.parse(outputText);const {comment,...proposedPlan}=draft;return json({comment,proposedPlan});
    }
    const loginEmail=String(body.loginEmail||'').trim().toLowerCase();
    const password=String(body.password||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail))return json({error:'請輸入有效的學生 Email'},400);
    if(body.action==='create_student_account'){
      if(password.length<6||password.length>72)return json({error:'密碼須為 6 至 72 個字元'},400);
      const classId=String(body.classId||'');const {data:klass}=await db.from('classes').select('id,name,teacher_id').eq('id',classId).maybeSingle();
      if(!klass||klass.teacher_id!==user.id)return json({error:'沒有權限管理這個班級'},403);
      const {data:owner}=await db.from('students').select('id').eq('login_email',loginEmail).gt('delete_after',new Date().toISOString()).limit(1).maybeSingle();if(owner)return json({error:'這個 Email 已由其他學生使用'},409);
      let code=identity();let created:any=null;
      for(let tries=0;tries<5&&!created;tries++){const result=await db.from('students').insert({class_id:classId,student_code:code,login_email:loginEmail,pin_hash:await hashPassword(password)}).select('id,student_code,login_email').maybeSingle();if(!result.error)created=result.data;else code=identity()}
      if(!created)return json({error:'暫時無法建立學生帳號'},500);
      const {data:project,error:projectError}=await db.from('research_projects').insert({student_id:created.id,title:'第一個研究歷程'}).select('id').single();
      if(projectError){await db.from('students').delete().eq('id',created.id);throw projectError}
      await db.from('thought_events').insert({student_id:created.id,research_id:project.id,event_type:'joined',content:{class_name:klass.name,created_by_teacher:true},source:'system'});
      return json({ok:true,studentId:created.id,studentCode:created.student_code,loginEmail});
    }
    if(body.action!=='update_student_account')return json({error:'未知操作'},400);
    const studentId=String(body.studentId||'');if(!studentId)return json({error:'缺少學生資料'},400);
    if(password&&(password.length<6||password.length>72))return json({error:'新密碼須為 6 至 72 個字元'},400);

    const {data:student}=await db.from('students').select('id,login_email,classes!inner(teacher_id)').eq('id',studentId).maybeSingle();
    if(!student||(student.classes as any)?.teacher_id!==user.id)return json({error:'沒有權限管理這位學生'},403);
    const {data:owner}=await db.from('students').select('id').eq('login_email',loginEmail).neq('id',studentId).gt('delete_after',new Date().toISOString()).limit(1).maybeSingle();
    if(owner)return json({error:'這個 Email 已由其他學生使用'},409);

    const changes:any={login_email:loginEmail};
    if(password)changes.pin_hash=await hashPassword(password);
    const {error}=await db.from('students').update(changes).eq('id',studentId);
    if(error)throw error;
    if(password)await db.from('student_sessions').delete().eq('student_id',studentId);
    return json({ok:true,loginEmail,passwordChanged:Boolean(password)});
  }catch(error){console.error(error);return json({error:'伺服器處理失敗'},500)}
});
