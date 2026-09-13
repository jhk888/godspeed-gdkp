'use strict';
const {onCall,HttpsError,onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {getAuth}=require('firebase-admin/auth');
const crypto=require('node:crypto');
const {execute}=require('./core');
const {receipt,scan}=require('./usdcWatch');
initializeApp();
const RPC=defineSecret('GS_ETHEREUM_RPC'),CLIENT_SECRET=defineSecret('GS_DISCORD_SECRET');
const CLIENT_ID=defineString('GS_DISCORD_CLIENT_ID'),SITE=defineString('GS_SITE_URL',{default:'https://godspeedgdkp.bid/'}),RL=defineString('GS_RL_DISCORD_ID',{default:'670939357686923265'});
const region='us-central1';
async function commit(actor,op,data,id){let result,error;const now=Date.now();const tx=await getDatabase().ref().transaction(root=>{try{const out=execute(root,actor,op,data,id,now);result=out.result;error=null;return out.root;}catch(e){error=e;return;}},undefined,false);if(!tx.committed)throw new HttpsError('failed-precondition',error?.message||'Transaction conflicted; retry');return result;}
function identity(request){if(!request.auth?.token?.discordId||request.auth.uid!=='discord_'+request.auth.token.discordId)throw new HttpsError('unauthenticated','Verify Discord for GS');return {id:String(request.auth.token.discordId),rl:String(request.auth.token.discordId)===RL.value()};}
exports.gsCommand=onCall({region,secrets:[RPC],timeoutSeconds:60},async request=>{
  const actor=identity(request),{op,data={},id}=request.data||{};
  if(op==='quoteGold'){
    if(!actor.rl)throw new HttpsError('permission-denied','Raid leader required');const root=(await getDatabase().ref().get()).val()||{},s=root.runs?.[safe(data.runId)]?.settlement,r=s?.raiders?.[safe(data.raiderKey)];if(!r)throw new HttpsError('not-found','Raider missing');let left=Math.round((r.gsCut-(r.gsCredited||0))*1e6),gold=0;for(const t of Object.values(root.accounts?.['_run_'+data.runId]?.tickets||{}).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))){const n=Math.min(left,Math.round(t.remainingUsd*1e6));gold+=n/1e6*1000/t.rateUsdPer1000;left-=n;if(!left)break;}if(left>0)throw new HttpsError('failed-precondition','Insufficient funded pot');return {gold};
  }
  if(['receive','withdrawPaid','assignDeposit'].includes(op)){
    if(!actor.rl)throw new HttpsError('permission-denied','Raid leader required');
    const cfg=(await getDatabase().ref('gs/config').get()).val();if(!cfg?.enabled)throw new HttpsError('failed-precondition','GS disabled');
    const ev=await receipt(RPC.value(),data.hash,Number(data.logIndex),cfg.confirmations);
    if(op==='assignDeposit')return commit(actor,op,{owner:String(data.owner),runId:safe(data.runId),event:ev,forceMint:!!data.forceMint},id);
    const expected=(await getDatabase().ref(op==='receive'?'gs/deposits/'+safe(data.id):'gs/withdrawals/'+safe(data.id)).get()).val();if(!expected)throw new HttpsError('not-found','Request not found');
    if(op==='receive'&&ev.blockTime<expected.createdAt-60000)throw new HttpsError('failed-precondition','Transfer predates this request');
    return commit(actor,op,{id:data.id,event:ev,forceMint:!!data.forceMint},id);
  }
  if(op==='snapshot'){
    const root=(await getDatabase().ref().get()).val()||{};
    if(root.bans?.['discord_'+actor.id])throw new HttpsError('permission-denied','Banned account');
    const a=root.accounts?.[actor.id]||{},cfg=root.gs?.config||{};
    return {account:{gsBalance:a.gsBalance||0,tickets:a.tickets||{},ledger:Object.fromEntries(Object.entries(a.ledger||{}).filter(([,e])=>e.unit==='GS'))},config:{enabled:!!cfg.enabled,address:cfg.address||'',network:'Ethereum',houseId:cfg.houseId||''},deposits:Object.fromEntries(Object.entries(root.gs?.deposits||{}).filter(([,d])=>actor.rl||d.owner===actor.id)),withdrawals:Object.fromEntries(Object.entries(root.gs?.withdrawals||{}).filter(([,w])=>actor.rl||w.owner===actor.id).map(([id,w])=>[id,{...w,pieces:undefined}]).map(([id,w])=>{delete w.pieces;return[id,w];})),house:actor.rl?{balance:root.accounts?.[cfg.houseId]?.gsBalance||0,reserved:root.accounts?.[cfg.houseId]?.usdReserved||0}:null,unmatched:actor.rl?root.gs?.unmatched||{}:{}};
  }
  return commit(actor,op,data,id);
});
function safe(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s))throw new HttpsError('invalid-argument','Invalid key');return s;}
// OAuth is bound to a short-lived HttpOnly state cookie. Tokens never enter RTDB.
exports.gsDiscordAuth=onRequest({region,secrets:[CLIENT_SECRET],timeoutSeconds:30},async(req,res)=>{
  const callback=`https://${region}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/gsDiscordAuth`;
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
  try{
    if(!req.query.code){const state=crypto.randomBytes(32).toString('hex');res.set('Set-Cookie',`gs_oauth=${state}; Max-Age=300; HttpOnly; Secure; SameSite=Lax; Path=/`);const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:CLIENT_ID.value(),redirect_uri:callback,response_type:'code',scope:'identify',state}).toString();res.redirect(url.toString());return;}
    const cookie=String(req.headers.cookie||'').match(/(?:^|;\s*)gs_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];const state=String(req.query.state||'');if(!cookie||state.length!==64||!crypto.timingSafeEqual(Buffer.from(state),Buffer.from(cookie)))throw Error('Invalid login state');res.set('Set-Cookie','gs_oauth=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/');
    const response=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID.value(),client_secret:CLIENT_SECRET.value(),grant_type:'authorization_code',code:String(req.query.code),redirect_uri:callback})});if(!response.ok)throw Error('Discord token exchange failed');const token=await response.json();const me=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`}});if(!me.ok)throw Error('Discord verification failed');const user=await me.json();if(!/^\d+$/.test(user.id))throw Error('Invalid Discord ID');
    if((await getDatabase().ref('bans/discord_'+user.id).get()).exists())throw Error('Account banned');
    const customToken=await getAuth().createCustomToken('discord_'+user.id,{discordId:user.id,raidLeader:user.id===RL.value()});
    await getDatabase().ref('accounts/'+user.id+'/profile').update({discordId:user.id,discordName:user.username,displayName:user.global_name||user.username});
    const target=new URL(SITE.value());target.hash=new URLSearchParams({gs_token:customToken,gs_user:JSON.stringify({id:user.id,username:user.username,displayName:user.global_name||user.username,avatar:user.avatar?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`:''})}).toString();res.redirect(target.toString());
  }catch(e){res.status(400).send('Discord verification failed. Return to the site and retry.');}
});
exports.gsUsdcWatch=onSchedule({schedule:'every 2 minutes',region,secrets:[RPC],timeoutSeconds:120},async()=>{
  const db=getDatabase(),cfg=(await db.ref('gs/config').get()).val();if(!cfg?.enabled)return;
  await scan({rpc:RPC.value(),cfg,db,credit:async(id,event)=>commit({id:RL.value(),rl:true},'receive',{id,event},'chain_'+event.id)});
});
