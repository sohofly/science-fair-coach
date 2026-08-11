import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsHeaders,json} from '../_shared/cors.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const enc=new TextEncoder();
function hex(value:ArrayBuffer){return [...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sha(value:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(value)))}
function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function randomFrom(chars:string,n:number){const bytes=crypto.getRandomValues(new Uint8Array(n));return [...bytes].map(x=>chars[x%chars.length]).join('')}
async function hashPassword(password:string,salt=randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',16)){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:120000,hash:'SHA-256'},key,256);return `${salt}:${hex(bits)}`}
function identity(){const animals=['藍鯨','雲豹','水獺','山羌','石虎','海豚','角鴞','穿山甲'];return `${animals[crypto.getRandomValues(new Uint8Array(1))[0]%animals.length]}-${randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',4)}`}
async function admin(req:Request){const raw=req.headers.get('x-admin-token')||'';if(!raw)return null;const {data}=await db.from('admin_sessions').select('administrator_id,expires_at,administrators!inner(username,must_change_password)').eq('token_hash',await sha(raw)).gt('expires_at',new Date().toISOString()).maybeSingle();return data}
async function makeJoinCode(){for(let i=0;i<10;i++){const code=randomFrom('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',6);const {data}=await db.from('classes').select('id').eq('join_code',code).maybeSingle();if(!data)return code}throw new Error('cannot create join code')}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const body=await req.json();
    if(body.action==='config'){
      const {data}=await db.from('app_settings').select('value').eq('key','teacher_google_login').maybeSingle();
      return json({teacherGoogleLogin:Boolean(data?.value)});
    }
    if(body.action==='login'){
      const username=String(body.username||'').trim();const password=String(body.password||'');
      const {data,error}=await db.rpc('verify_admin_password',{login_name:username,login_password:password});
      if(error||!data?.[0])return json({error:'管理者帳號或密碼錯誤'},401);
      const raw=token(),expiresAt=new Date(Date.now()+8*60*60*1000).toISOString();
      await db.from('admin_sessions').delete().lt('expires_at',new Date().toISOString());
      const {error:sessionError}=await db.from('admin_sessions').insert({administrator_id:data[0].admin_id,token_hash:await sha(raw),expires_at:expiresAt});if(sessionError)throw sessionError;
      return json({token:raw,expiresAt,mustChangePassword:data[0].must_change});
    }
    const session:any=await admin(req);if(!session)return json({error:'總管理者登入已失效'},401);
    const administrator=(session.administrators as any);if(administrator.must_change_password&&!['change_password','logout'].includes(body.action))return json({error:'請先更改預設密碼',code:'PASSWORD_CHANGE_REQUIRED'},403);
    if(body.action==='logout'){await db.from('admin_sessions').delete().eq('token_hash',await sha(req.headers.get('x-admin-token')||''));return json({ok:true})}
    if(body.action==='change_password'){
      const next=String(body.newPassword||'');if(next==='admin'||next.length<10||next.length>72)return json({error:'新密碼須為 10 至 72 個字元，且不可使用 admin'},400);
      const {error}=await db.rpc('set_admin_password',{target_id:session.administrator_id,new_password:next});if(error)throw error;return json({ok:true,relogin:true});
    }
    if(body.action==='dashboard'){
      const [{data:teachers,error},{data:classes},{data:students},{data:setting}]=await Promise.all([
        db.from('teacher_profiles').select('user_id,email,display_name,active,created_at').order('created_at'),
        db.from('classes').select('id,teacher_id,name,join_code,created_at').order('created_at'),
        db.from('students').select('id,class_id,student_code,login_email,display_label,created_at,active_until,delete_after,research_projects(id,title,created_at)').order('created_at'),
        db.from('app_settings').select('value').eq('key','teacher_google_login').maybeSingle()
      ]);if(error)throw error;
      const tree=(teachers||[]).map((t:any)=>({...t,classes:(classes||[]).filter((c:any)=>c.teacher_id===t.user_id).map((c:any)=>({...c,students:(students||[]).filter((s:any)=>s.class_id===c.id)}))}));
      return json({teachers:tree,teacherGoogleLogin:Boolean(setting?.value)});
    }
    if(body.action==='student_detail'){
      const studentId=String(body.studentId||''),researchId=String(body.researchId||'');
      if(!studentId)return json({error:'缺少學生資料'},400);
      const {data:student,error:studentError}=await db.from('students').select('id,student_code,login_email,display_label,created_at,active_until,delete_after,classes!inner(id,name)').eq('id',studentId).maybeSingle();
      if(studentError)throw studentError;if(!student)return json({error:'找不到學生'},404);
      const {data:projects,error:projectsError}=await db.from('research_projects').select('id,title,selected_topic,created_at,updated_at').eq('student_id',studentId).order('created_at',{ascending:false});
      if(projectsError)throw projectsError;
      if(!researchId)return json({student,projects:projects||[]});
      const project=(projects||[]).find((item:any)=>item.id===researchId);if(!project)return json({error:'找不到這位學生的研究主題'},404);
      const [{data:events,error:eventsError},{data:researchPlan},{data:suggestions},{data:experimentRecords}]=await Promise.all([
        db.from('thought_events').select('id,event_type,content,source,created_at').eq('student_id',studentId).eq('research_id',researchId).order('created_at'),
        db.from('research_plans').select('id,current_plan,version,created_at,updated_at').eq('student_id',studentId).eq('research_id',researchId).maybeSingle(),
        db.from('research_plan_suggestions').select('id,comment,proposed_plan,status,created_at,decided_at').eq('student_id',studentId).eq('research_id',researchId).order('created_at',{ascending:false}),
        db.from('experiment_records').select('id,record_kind,topic_snapshot,method,result,file_name,mime_type,ai_review,created_at').eq('student_id',studentId).eq('research_id',researchId).order('created_at')
      ]);if(eventsError)throw eventsError;
      return json({student,projects:projects||[],currentProject:project,events:events||[],researchPlan:researchPlan||null,suggestions:suggestions||[],experimentRecords:experimentRecords||[]});
    }
    if(body.action==='set_google_login'){
      const enabled=Boolean(body.enabled);const {error}=await db.from('app_settings').upsert({key:'teacher_google_login',value:enabled,updated_at:new Date().toISOString()});if(error)throw error;return json({ok:true,enabled});
    }
    if(body.action==='create_teacher'){
      const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),displayName=String(body.displayName||'').trim().slice(0,80)||null;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'請輸入有效的教師 Email'},400);if(password.length<8||password.length>72)return json({error:'教師密碼須為 8 至 72 個字元'},400);
      const {data:created,error}=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:displayName,role:'teacher'}});if(error)return json({error:error.message},409);
      const {error:profileError}=await db.from('teacher_profiles').insert({user_id:created.user.id,email,display_name:displayName});if(profileError){await db.auth.admin.deleteUser(created.user.id);throw profileError}return json({ok:true,teacherId:created.user.id});
    }
    if(body.action==='set_teacher_active'){
      const {error}=await db.from('teacher_profiles').update({active:Boolean(body.active)}).eq('user_id',String(body.teacherId||''));if(error)throw error;return json({ok:true});
    }
    if(body.action==='create_class'){
      const teacherId=String(body.teacherId||''),name=String(body.name||'').trim();if(!teacherId||!name||name.length>80)return json({error:'班級名稱不正確'},400);
      const {data:profile}=await db.from('teacher_profiles').select('user_id').eq('user_id',teacherId).eq('active',true).maybeSingle();if(!profile)return json({error:'找不到可用的教師帳號'},404);
      const {data,error}=await db.from('classes').insert({teacher_id:teacherId,name,join_code:await makeJoinCode()}).select().single();if(error)throw error;return json({ok:true,class:data});
    }
    if(body.action==='create_student'){
      const classId=String(body.classId||''),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'請輸入有效的學生 Email'},400);if(password.length<6||password.length>72)return json({error:'學生密碼須為 6 至 72 個字元'},400);
      const {data:klass}=await db.from('classes').select('id,name').eq('id',classId).maybeSingle();if(!klass)return json({error:'找不到班級'},404);const {data:owner}=await db.from('students').select('id').eq('login_email',email).gt('delete_after',new Date().toISOString()).limit(1).maybeSingle();if(owner)return json({error:'這個 Email 已由其他學生使用'},409);
      let created:any=null;for(let i=0;i<5&&!created;i++){const result=await db.from('students').insert({class_id:classId,student_code:identity(),login_email:email,pin_hash:await hashPassword(password)}).select('id,student_code').maybeSingle();if(!result.error)created=result.data}if(!created)return json({error:'無法建立學生帳號'},500);
      const {data:project,error}=await db.from('research_projects').insert({student_id:created.id,title:'第一個研究歷程'}).select('id').single();if(error){await db.from('students').delete().eq('id',created.id);throw error}await db.from('thought_events').insert({student_id:created.id,research_id:project.id,event_type:'joined',content:{class_name:klass.name,created_by_admin:true},source:'system'});return json({ok:true,studentId:created.id,studentCode:created.student_code});
    }
    return json({error:'未知操作'},400);
  }catch(error){console.error(error);return json({error:'伺服器處理失敗'},500)}
});
