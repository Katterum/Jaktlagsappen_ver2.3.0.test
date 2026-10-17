(function(){
 const c=window.KATTERUMS_CLOUD_CONFIG||{};
 const ready=window.supabase&&c.url&&c.publishableKey&&c.publishableKey.startsWith('sb_publishable_');
 const client=ready?window.supabase.createClient(c.url,c.publishableKey,{auth:{persistSession:true,autoRefreshToken:true}}):null;
 async function login(username,password){if(!client)return {ok:false,error:'Supabase är inte konfigurerat.'};try{const {data,error}=await client.functions.invoke('username-login',{body:{username,password,teamId:c.teamId}});if(error||!data?.access_token)return {ok:false,error:data?.error||error?.message||'Fel användarnamn eller lösenord.'};const {error:sessionError}=await client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(sessionError)return {ok:false,error:'Sessionen kunde inte startas.'};return {ok:true,user:{memberId:String(data.member_id),role:data.role,userId:data.user_id}}}catch(e){return {ok:false,error:e.message||'Inloggningen misslyckades.'}}}
 async function manageUser(payload){if(!client)return {ok:false,error:'Supabase är inte konfigurerat.'};try{const {data,error}=await client.functions.invoke('manage-user-v2',{body:payload});return error?{ok:false,error:data?.error||error.message}:{ok:true,...data}}catch(e){return {ok:false,error:e.message}}}
 window.KatterumsCloud={client,login,manageUser};
})();

/* v2.2.7: authoritative session helpers */
(function(){
  if(!window.KatterumsCloud?.client) return;
  const oldLogin=window.KatterumsCloud.login;
  const oldManage=window.KatterumsCloud.manageUser;
  async function login(username,password){
    const result=await oldLogin(username,password);
    if(!result?.ok) return result;
    const {data:{user},error}=await window.KatterumsCloud.client.auth.getUser();
    if(error||!user) return {ok:false,error:'Den autentiserade sessionen kunde inte verifieras.'};
    return result;
  }
  window.KatterumsCloud={...window.KatterumsCloud,login,manageUser:oldManage};
})();
