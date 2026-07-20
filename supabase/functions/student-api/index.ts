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
      const attemptKey=await sha(`join:${req.headers.get('x-forwarded-for')||'unknown'}:${classCode}`);const since=new Date(Date.now()-15*60*1000).toISOString();const {count}=await db.from('student_login_attempts').select('*',{count:'exact',head:true}).eq('attempt_key',attemptKey).gte('attempted_at',since);if((count||0)>=20)return json({error:'建立次數過多，請15分鐘後再試'},429);await db.from('student_login_attempts').insert({attempt_key:attemptKey});
      const {data:klass}=await db.from('classes').select('id,name').eq('join_code',classCode).maybeSingle();
      if(!klass)return json({error:'班級加入碼不存在'},404);
      let code=identity();let pin=randomFrom('23456789',6);
      for(let tries=0;tries<5;tries++){
        const {data,error}=await db.from('students').insert({class_id:klass.id,student_code:code,pin_hash:await hashPin(pin)}).select().single();
        if(!error&&data){const token=crypto.randomUUID()+crypto.randomUUID();await db.from('student_sessions').insert({student_id:data.id,token_hash:await sha(token)});await db.from('thought_events').insert({student_id:data.id,event_type:'joined',content:{class_name:klass.name},source:'system'});return json({student:{...data,pin_hash:undefined,class_name:klass.name},pin,token});}
        code=identity();
      }
      return json({error:'暫時無法建立學生代號'},500);
    }
    if(action==='resume'){
      const classCode=String(body.classCode||'').toUpperCase().trim();const studentCode=String(body.studentCode||'').toUpperCase().trim();
      const attemptKey=await sha(`${req.headers.get('x-forwarded-for')||'unknown'}:${classCode}:${studentCode}`);const since=new Date(Date.now()-15*60*1000).toISOString();
      const {count}=await db.from('student_login_attempts').select('*',{count:'exact',head:true}).eq('attempt_key',attemptKey).gte('attempted_at',since);if((count||0)>=10)return json({error:'嘗試次數過多，請15分鐘後再試'},429);
      const {data}=await db.from('students').select('*,classes!inner(name,join_code)').eq('student_code',studentCode).eq('classes.join_code',classCode).maybeSingle();
      if(!data||!await verifyPin(String(body.pin||''),data.pin_hash)){await db.from('student_login_attempts').insert({attempt_key:attemptKey});return json({error:'代號或PIN不正確'},401);}
      if(new Date(data.delete_after)<=new Date())return json({error:'紀錄已到期'},410);
      const token=crypto.randomUUID()+crypto.randomUUID();await db.from('student_sessions').insert({student_id:data.id,token_hash:await sha(token)});delete data.pin_hash;return json({student:data,token});
    }
    const student:any=await sessionStudent(req);if(!student)return json({error:'學生登入已失效'},401);
    if(action==='get'){const [{data:events},{data:experimentRecords}]=await Promise.all([db.from('thought_events').select('*').eq('student_id',student.id).order('created_at'),db.from('experiment_records').select('id,method,result,file_name,mime_type,ai_review,created_at').eq('student_id',student.id).order('created_at')]);delete student.pin_hash;return json({student,events,experimentRecords,status:new Date(student.active_until)<=new Date()?'read_only':'active'});}
    if(new Date(student.active_until)<=new Date())return json({error:'紀錄已進入唯讀期'},423);
    if(action==='event'){
      const allowed=['division_selected','profile_updated','interest_selected','observation_entered','question_shown','answer_submitted','topics_recommended','topic_selected','topic_rejected','source_opened','plan_created'];
      if(!allowed.includes(body.eventType))return json({error:'不允許的紀錄類型'},400);
      if(JSON.stringify(body).length>20000)return json({error:'單次紀錄內容過長'},413);
      const {error}=await db.from('thought_events').insert({student_id:student.id,event_type:body.eventType,content:body.content||{},source:body.source==='system'?'system':'student'});if(error)throw error;
      if(body.profile)await db.from('students').update({profile:body.profile}).eq('id',student.id);
      if(body.selectedTopic)await db.from('students').update({selected_topic:body.selectedTopic}).eq('id',student.id);
      return json({ok:true});
    }
    return json({error:'未知操作'},400);
  }catch(error){console.error(error);return json({error:'伺服器處理失敗'},500)}
});
