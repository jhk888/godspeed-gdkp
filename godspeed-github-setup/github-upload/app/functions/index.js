'use strict';
const {onCall,HttpsError,onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {getAuth}=require('firebase-admin/auth');
const crypto=require('node:crypto');
const {getStorage}=require('firebase-admin/storage');
const CLAIM_BUCKET='godspeed-gdkp.firebasestorage.app';
const {execute}=require('./core');
const {executeRunBid}=require('./bids');
const {validatedTransaction,runOperations,executeRunCommand}=require('./transactions');
const {executeAttendance,attendanceOps}=require('./attendance');
initializeApp();
const CLIENT_SECRET=defineSecret('GS_DISCORD_SECRET');
const CLIENT_ID=defineString('GS_DISCORD_CLIENT_ID'),SITE=defineString('GS_SITE_URL'),RL=defineString('GS_RL_DISCORD_ID',{default:'670939357686923265'});
const region='us-central1';
async function commit(actor,op,data,id){
 const now=Date.now();let attempts=0,executionMs=0;
 try{return await validatedTransaction(getDatabase().ref(),root=>{attempts++;const start=Date.now();try{return execute(root,actor,op,data,id,now);}finally{executionMs+=Date.now()-start;}});}
 catch(e){throw new HttpsError('failed-precondition',e.message||'Transaction conflicted; retry');}
 finally{console.info('Save timing',{op,totalMs:Date.now()-now,executionMs,attempts});}
}
function identity(request){if(!request.auth?.token?.discordId||request.auth.uid!=='discord_'+request.auth.token.discordId)throw new HttpsError('unauthenticated','Verify Discord for GS');return {id:String(request.auth.token.discordId),rl:request.auth.token.raidLeader===true&&String(request.auth.token.discordId)===RL.value()};}
exports.gsCommand=onCall({region,memory:'512MiB',concurrency:8,timeoutSeconds:60,minInstances:1,maxInstances:2},async request=>{
  const actor=identity(request),{op,data={},id}=request.data||{};
  const started=Date.now(),db=getDatabase(),isBid=op==='placeBid',isRunCommand=runOperations.has(op);
  if(isBid||isRunCommand){safe(data.runId);if(isBid)safe(data.auctionId);if(data.raiderKey!==undefined)safe(data.raiderKey);if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw new HttpsError('invalid-argument','Invalid request ID');}
  const [ban,configSnap,legacyReceipt]=await Promise.all([db.ref('bans/discord_'+actor.id).get(),db.ref(isBid||isRunCommand?'gs/config':'gs/config/sitePaused').get(),isBid||isRunCommand?db.ref('gs/ops/'+id).get():Promise.resolve(null)]);
  if(ban.exists())throw new HttpsError('permission-denied','Account banned');
  const paused=isBid||isRunCommand?configSnap.val()?.sitePaused:configSnap.val();
  if(paused===true&&!actor.rl)throw new HttpsError('unavailable','The site is temporarily paused by the leader');
  if(op==='prepareClaimImage'){
    const runId=safe(data.runId),raiderKey=safe(data.raiderKey),image=String(data.imageData||'');
    if(image.length>1250000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw new HttpsError('invalid-argument','Attach a prepared screenshot');
    const snap=await db.ref('runs/'+runId+'/settlement').get(),s=snap.val(),r=s?.raiders?.[raiderKey];
    if(!s?.payoutStarted||!r||String(r.gsOwner)!==actor.id||r.paid)throw new HttpsError('permission-denied','Upload for your own unpaid claim');
    const bytes=Buffer.from(image.split(',')[1],'base64'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const path='claim-images/'+runId+'/'+actor.id+'/'+hash,token=crypto.randomUUID(),file=getStorage().bucket(CLAIM_BUCKET).file(path);
    try{
      await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:image.slice(5,image.indexOf(';')),cacheControl:'private,max-age=31536000',metadata:{firebaseStorageDownloadTokens:token,owner:actor.id,runId}}});
    }catch(e){if(Number(e.code)!==412)throw new HttpsError('unavailable','Image upload unavailable; the claim can still use its attached screenshot');}
    return {path};
  }
  if(isBid){
    const checked=Date.now();let result;
    try{result=await validatedTransaction(db.ref('runs/'+data.runId),run=>executeRunBid(run,actor,data,id,configSnap.val()||{},legacyReceipt.val()));}
    catch(e){throw new HttpsError('failed-precondition',e.message||'Bid conflicted; retry');}
    // The durable receipt is committed with the bid; also retain the existing audit view.
    await db.ref('audit/'+data.runId+'/'+id).set({type:'gs_placeBid',actor:actor.id,ts:started,amount:data.amount,reason:'',operationId:id});
    console.info('Bid timing',{authorizationMs:checked-started,totalMs:Date.now()-started});
    return result;
  }
  if(isRunCommand){
    const checked=Date.now();let attempts=0,preparedImage;
    if(op==='submitClaim'&&data.imageRef){
      const prefix='claim-images/'+data.runId+'/'+actor.id+'/';
      if(typeof data.imageRef!=='string'||!data.imageRef.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(data.imageRef.slice(prefix.length)))throw new HttpsError('invalid-argument','Invalid screenshot reference');
      const [metadata]=await getStorage().bucket(CLAIM_BUCKET).file(data.imageRef).getMetadata();
      const token=metadata.metadata?.firebaseStorageDownloadTokens;
      if(metadata.metadata?.owner!==actor.id||metadata.metadata?.runId!==data.runId||!token||Number(metadata.size)>1000000)throw new HttpsError('permission-denied','Screenshot does not belong to this claim');
      preparedImage={url:'https://firebasestorage.googleapis.com/v0/b/'+CLAIM_BUCKET+'/o/'+encodeURIComponent(data.imageRef)+'?alt=media&token='+encodeURIComponent(token),bytes:Number(metadata.size)};
    }
    try{
      const result=await validatedTransaction(db.ref('runs/'+data.runId),run=>{
        attempts++;return executeRunCommand(run,actor,op,data,id,configSnap.val()||{},legacyReceipt.val(),started,preparedImage);
      });
      await db.ref('audit/'+data.runId+'/'+id).set({type:'gs_'+op,actor:actor.id,ts:started,amount:data.amount||0,reason:data.reason||'',operationId:id});
      return result;
    }catch(e){throw new HttpsError('failed-precondition',e.message||'Save conflicted; retry');}
    finally{console.info('Run save timing',{op,authorizationMs:checked-started,totalMs:Date.now()-started,attempts});}
  }
  if(['attendanceJoin','attendanceVerify','attendanceLeave','attendancePreference'].includes(op)){
    const runId=safe(data.runId),checked=Date.now(),needsCode=['attendanceJoin','attendanceVerify'].includes(op);
    if(needsCode&&!actor.rl){
      const limit=await db.ref('attendanceAttempts/'+actor.id).transaction(value=>{
        const v=value&&checked-value.since<60000?value:{since:checked,count:0};
        if(v.count>=10)return;return {since:v.since,count:v.count+1};
      },undefined,false);
      if(!limit.committed)throw new HttpsError('resource-exhausted','Too many attempts. Wait one minute.');
    }
    const [secret,profile]=await Promise.all([
      needsCode?db.ref('attendanceSecrets/'+runId).get():Promise.resolve(null),
      op==='attendanceJoin'?db.ref('accounts/'+actor.id+'/profile').get():Promise.resolve(null)
    ]);
    try{
      const result=await validatedTransaction(db.ref('runs/'+runId),run=>{
        const out=executeAttendance({runs:{[runId]:run},attendanceSecrets:{[runId]:secret?.val()||{}},accounts:{[actor.id]:{profile:profile?.val()||{}}}},actor,op,data,checked);
        return {root:out.root.runs[runId],result:out.result};
      });
      if(result.error)throw Error(result.error);
      if(op==='attendanceJoin')await db.ref('audit/'+runId+'/checkin_'+actor.id+'_'+checked).set({ts:checked,type:'check-in',actor:actor.id,discordName:result.record.discordName,character:result.record.character});
      return result;
    }catch(e){throw new HttpsError('failed-precondition',e.message||'Check-in conflicted; retry');}
    finally{console.info('Attendance timing',{op,totalMs:Date.now()-started});}
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
    if(!actor.rl)throw new HttpsError('permission-denied','Raid leader required');
    const runId=safe(data.runId),key=safe(data.raiderKey),db=getDatabase();
    const [settlementSnap,ticketsSnap]=await Promise.all([db.ref('runs/'+runId+'/settlement').get(),db.ref('accounts/_run_'+runId+'/tickets').get()]);
    const s=settlementSnap.val(),r=s?.raiders?.[key];
    if(!s?.payoutStarted||!r)throw new HttpsError('failed-precondition','Locked raider missing');
    let left=Math.round((r.gsCut-(r.gsCredited||0))*1e6),gold=0;const due=left;
    if(left<=0)throw new HttpsError('failed-precondition','No outstanding payout');
    for(const t of Object.values(ticketsSnap.val()||{}).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))){
      const n=Math.min(left,Math.round(t.remainingUsd*1e6));gold+=n/1e6*1000/t.rateUsdPer1000;left-=n;if(!left)break;
    }
    if(left>0)throw new HttpsError('failed-precondition','Insufficient funded pot');
    if(s.payoutUsdPer1000)gold=due/1e6*1000/s.payoutUsdPer1000;
    return {gold,payoutRate:s.payoutUsdPer1000??null};
  }
  if(['configure','depositRequest','depositCancel','submitHash','receive','assignDeposit','withdraw','withdrawPaid','haircut'].includes(op))throw new HttpsError('failed-precondition','Automated blockchain operations are disabled. Use manual GC accounting.');
  if(op==='snapshot'){
    // Balances do not need auctions, archives, image attachments or the full database.
    const db=getDatabase(),adminView=actor.rl&&data.scope!=='account';
    const [configSnap,accountsSnap,depositsSnap,withdrawalsSnap,receiptsSnap]=await Promise.all([
      db.ref('gs/config').get(),db.ref(adminView?'accounts':'accounts/'+actor.id).get(),
      adminView?db.ref('gs/deposits').get():Promise.resolve(null),db.ref('gs/withdrawals').get(),
      adminView?db.ref('gs/manualReceipts').get():Promise.resolve(null)
    ]);
    const root={accounts:adminView?(accountsSnap.val()||{}):{[actor.id]:accountsSnap.val()||{}},gs:{config:configSnap.val()||{},deposits:depositsSnap?.val()||{},withdrawals:withdrawalsSnap.val()||{},manualReceipts:receiptsSnap?.val()||{}}};
    const a=root.accounts?.[actor.id]||{},cfg=root.gs?.config||{};
    return {memberActivity:adminView?Object.entries(root.accounts||{}).filter(([owner])=>/^\d+$/.test(owner)).flatMap(([owner,a])=>Object.entries(a.ledger||{}).filter(([,e])=>e.unit==='GS').map(([id,e])=>({id,owner,type:e.type,amount:e.gsDelta,createdAt:e.createdAt,reason:e.reason||'',runId:e.runId||''}))).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200):[],payoutMethodsVersion:1,claimImagesVersion:1,account:{gsBalance:a.gsBalance||0,tickets:a.tickets||{},ledger:Object.fromEntries(Object.entries(a.ledger||{}).filter(([,e])=>e.unit==='GS'))},config:{enabled:!!cfg.enabled,memberGCEnabled:cfg.memberGCEnabled===true,address:cfg.address||'',accountingMode:'manual',houseId:cfg.houseId||''},deposits:Object.fromEntries(Object.entries(root.gs?.deposits||{}).filter(([,d])=>adminView||d.owner===actor.id)),withdrawals:Object.fromEntries(Object.entries(root.gs?.withdrawals||{}).filter(([,w])=>adminView||w.owner===actor.id).map(([id,w])=>[id,{...w,pieces:undefined}]).map(([id,w])=>{delete w.pieces;return[id,w];})),house:adminView?{balance:root.accounts?.[cfg.houseId]?.gsBalance||0,reserved:root.accounts?.[cfg.houseId]?.usdReserved||0}:null,manualReceipts:adminView?root.gs?.manualReceipts||{}:{},members:adminView?Object.fromEntries(Object.entries(root.accounts||{}).filter(([id])=>/^\d+$/.test(id)).map(([id,a])=>[id,{name:a.profile?.displayName||a.profile?.discordName||id,balance:a.gsBalance||0}])):{}};
  }
  return commit(actor,op,data,id);
});
function safe(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s))throw new HttpsError('invalid-argument','Invalid key');return s;}
const {createHandler}=require('./discordAuth');
exports.gsDiscordAuth=onRequest({region,secrets:[CLIENT_SECRET],timeoutSeconds:30,minInstances:0,maxInstances:2,invoker:'public'},createHandler({secret:()=>CLIENT_SECRET.value(),database:getDatabase(),auth:getAuth(),site:()=>SITE.value(),leader:()=>RL.value()}));






