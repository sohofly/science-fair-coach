import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsHeaders,json} from '../_shared/cors.ts';
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.headers.get('authorization')!==`Bearer ${Deno.env.get('CRON_SECRET')}`)return json({error:'unauthorized'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data,error}=await db.rpc('purge_expired_students');
  if(error)return json({error:error.message},500);return json({deleted:data});
});
