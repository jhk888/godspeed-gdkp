'use strict';
const {onCall,HttpsError,onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {getAuth}=require('firebase-admin/auth');
const crypto=require('node:crypto');
const {execute}=require('./core');
const {executeRunBid}=require('./bids');
const {validatedTransaction}=require('./transactions');
const {executeAttendance,attendanceOps}=require('./attendance');
initializeApp();
const CLIENT_SECRET=defineSecret('GS_DISCORD_SECRET');
const CLIENT_ID=defineString('GS_DISCORD_CLIENT_ID'),SITE=defineString('GS_SITE_URL'),RL=defineString('GS_RL_DISCORD_ID',{default:'670939357686923265'});
const region='us-central1';
async function commit(actor,op,data,id){
 const now=Date.now();
 try{return await validatedTransaction(getDatabase().ref(),root=>execute(root,actor,op,data,id,now));}
 catch(e){throw new HttpsError('failed-precondition',e.message||'Transaction conflicted; retry');}
}
function identity(request){if(!request.auth?.token?.discordId||request.auth.uid!=='discord_'+request.auth.token.discordId)throw new HttpsError('unauthenticated','Verify Discord for GS');return {id:String(request.auth.token.discordId),rl:request.auth.token.raidLeader===true&&String(request.auth.token.discordId)===RL.value()};}
exports.gsCommand=onCall({region,memory:'512MiB',concurrency:8,timeoutSeconds:60,minInstances:1,maxInstances:2},async request=>{
  const actor=identity(request),{op,data={},id}=request.data||{};
  const started=Date.now(),db=getDatabase(),isBid=op==='placeBid';
  if(isBid){safe(data.runId);safe(data.auctionId);if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw new HttpsError('invalid-argument','Invalid request ID');}
  const [ban,configSnap,legacyReceipt]=await Promise.all([db.ref('bans/discord_'+actor.id).get(),db.ref(isBid?'gs/config':'gs/config/sitePaused').get(),isBid?db.ref('gs/ops/'+id).get():Promise.resolve(null)]);
  if(ban.exists())throw new HttpsError('permission-denied','Account banned');
  const paused=isBid?configSnap.val()?.sitePaused:configSnap.val();
  if(paused===true&&!actor.rl)throw new HttpsError('unavailable','The site is temporarily paused by the leader');
  if(isBid){
    const checked=Date.now();let result;
    try{result=await validatedTransaction(db.ref('runs/'+data.runId),run=>executeRunBid(run,actor,data,id,configSnap.val()||{},legacyReceipt.val()));}
    catch(e){throw new HttpsError('failed-precondition',e.message||'Bid conflicted; retry');}
    // The durable receipt is committed with the bid; also retain the existing audit view.
    await db.ref('audit/'+data.runId+'/'+id).set({type:'gs_placeBid',actor:actor.id,ts:started,amount:data.amount,reason:'',operationId:id});
    console.info('Bid timing',{authorizationMs:checked-started,totalMs:Date.now()-started});
    return result;
  }
  if(attendanceOps.has(op)){
    const now=Date.now(),proposedCode=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('');
    let result;
    try{result=await validatedTransaction(getDatabase().ref(),root=>executeAttendance(root,actor,op,data,now,proposedCode));}
    catch(e){throw new HttpsError('failed-precondition',e.message||'Attendance update conflicted; retry');}
    if(result.error)throw new HttpsError('failed-precondition',result.error);
    return result;
  }
  if(op==='quoteGold'){
    if(!actor.rl)throw new HttpsError('permission-denied','Raid leader required');const root=(await getDatabase().ref().get()).val()||{},s=root.runs?.[safe(data.runId)]?.settlement,r=s?.raiders?.[safe(data.raiderKey)];if(!r)throw new HttpsError('not-found','Raider missing');let left=Math.round((r.gsCut-(r.gsCredited||0))*1e6),gold=0;for(const t of Object.values(root.accounts?.['_run_'+data.runId]?.tickets||{}).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))){const n=Math.min(left,Math.round(t.remainingUsd*1e6));gold+=n/1e6*1000/t.rateUsdPer1000;left-=n;if(!left)break;}if(left>0)throw new HttpsError('failed-precondition','Insufficient funded pot');return {gold};
  }
  if(['configure','depositRequest','depositCancel','submitHash','receive','assignDeposit','withdraw','withdrawPaid','haircut'].includes(op))throw new HttpsError('failed-precondition','Automated blockchain operations are disabled. Use manual GC accounting.');
  if(op==='snapshot'){
    // Balances do not need auctions, archives, image attachments or the full database.
    const db=getDatabase();
    const [configSnap,accountsSnap,depositsSnap,withdrawalsSnap,receiptsSnap]=await Promise.all([
      db.ref('gs/config').get(),db.ref(actor.rl?'accounts':'accounts/'+actor.id).get(),
      db.ref('gs/deposits').get(),db.ref('gs/withdrawals').get(),
      actor.rl?db.ref('gs/manualReceipts').get():Promise.resolve(null)
    ]);
    const root={accounts:actor.rl?(accountsSnap.val()||{}):{[actor.id]:accountsSnap.val()||{}},gs:{config:configSnap.val()||{},deposits:depositsSnap.val()||{},withdrawals:withdrawalsSnap.val()||{},manualReceipts:receiptsSnap?.val()||{}}};
    const a=root.accounts?.[actor.id]||{},cfg=root.gs?.config||{};
    return {payoutMethodsVersion:1,account:{gsBalance:a.gsBalance||0,tickets:a.tickets||{},ledger:Object.fromEntries(Object.entries(a.ledger||{}).filter(([,e])=>e.unit==='GS'))},config:{enabled:!!cfg.enabled,address:cfg.address||'',accountingMode:'manual',houseId:cfg.houseId||''},deposits:Object.fromEntries(Object.entries(root.gs?.deposits||{}).filter(([,d])=>actor.rl||d.owner===actor.id)),withdrawals:Object.fromEntries(Object.entries(root.gs?.withdrawals||{}).filter(([,w])=>actor.rl||w.owner===actor.id).map(([id,w])=>[id,{...w,pieces:undefined}]).map(([id,w])=>{delete w.pieces;return[id,w];})),house:actor.rl?{balance:root.accounts?.[cfg.houseId]?.gsBalance||0,reserved:root.accounts?.[cfg.houseId]?.usdReserved||0}:null,manualReceipts:actor.rl?root.gs?.manualReceipts||{}:{},members:actor.rl?Object.fromEntries(Object.entries(root.accounts||{}).filter(([id])=>/^\d+$/.test(id)).map(([id,a])=>[id,{name:a.profile?.displayName||a.profile?.discordName||id,balance:a.gsBalance||0}])):{}};
  }
  return commit(actor,op,data,id);
});
function safe(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s))throw new HttpsError('invalid-argument','Invalid key');return s;}
const {createHandler}=require('./discordAuth');
exports.gsDiscordAuth=onRequest({region,secrets:[CLIENT_SECRET],timeoutSeconds:30,minInstances:0,maxInstances:2,invoker:'public'},createHandler({secret:()=>CLIENT_SECRET.value(),database:getDatabase(),auth:getAuth(),site:()=>SITE.value(),leader:()=>RL.value()}));


