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
