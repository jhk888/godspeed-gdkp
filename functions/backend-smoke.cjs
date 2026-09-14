'use strict';
// Run inside functions/. All service URLs are fixed to localhost and a demo project.
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
const assert=require('node:assert/strict');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const projectId='demo-godspeed-coin';
const app=initializeApp({projectId},'local-backend-check');
const base='http://127.0.0.1:5001/'+projectId+'/us-central1/gsCommand';
const db='http://127.0.0.1:9000/';
const nonce=Date.now().toString(36);
let count=0;
async function json(url,options={}){const res=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});const body=await res.json();return {res,body};}
async function seed(path,value){const {res,body}=await json(db+path+'.json?ns='+projectId,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify(value)});assert.ok(res.ok,JSON.stringify(body));}
async function token(id){const custom=await getAuth(app).createCustomToken('discord_'+id,{discordId:id,raidLeader:id==='9001'});const {body}=await json('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});assert.ok(body.idToken,JSON.stringify(body));return body.idToken;}
async function call(auth,op,data={},id='smoke_'+nonce+'_'+(++count)){const {body}=await json(base,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify({data:{op,data,id}})});return body;}
function ok(r){assert.ok(!r.error,JSON.stringify(r));return r.result;}
function denied(r){assert.ok(r.error,JSON.stringify(r));}
async function check(name,fn){await fn();console.log('PASS: '+name);}
(async()=>{
 // Resets only the local demo database. Do not run concurrently with permissions tests.
 await seed('',{runs:{smoke_active:{settings:{title:'Local backend test'},settlement:{settlementMode:'coin',usdPer1000:10}}},bans:{discord_1003:true}});
 const leader=await token('9001'),alice=await token('1001'),bob=await token('1002'),banned=await token('1003');
 await check('Unsigned request rejected',async()=>{const r=await call(null,'snapshot');assert.equal(r.error?.status,'UNAUTHENTICATED');});
 await check('Signed-in raider can open own account',async()=>{assert.equal(ok(await call(alice,'snapshot')).account.gsBalance,0);});
 await check('Raider cannot configure treasury',async()=>denied(await call(alice,'configure',{address:'0x'+'1'.repeat(40)})));
 await check('Raid leader can configure demo treasury',async()=>ok(await call(leader,'configure',{address:'0x'+'1'.repeat(40)})));
 let deposit;
 const requestId='deposit_'+nonce;
 await check('Raider creates deposit request without minting',async()=>{deposit=ok(await call(alice,'depositRequest',{runId:'smoke_active',amount:10},requestId));assert.equal(deposit.owner,'1001');assert.equal(ok(await call(alice,'snapshot')).account.gsBalance,0);});
 await check('Retry returns same deposit request',async()=>{assert.deepEqual(ok(await call(alice,'depositRequest',{runId:'smoke_active',amount:10},requestId)),deposit);});
 await check('Raider cannot see another account deposit request',async()=>{assert.equal(Object.keys(ok(await call(bob,'snapshot')).deposits).length,0);});
 await check('Other raider cannot cancel deposit',async()=>denied(await call(bob,'depositCancel',{id:requestId})));
 await check('Raider cannot mark deposit received',async()=>denied(await call(alice,'receive',{id:requestId})));
 await check('Banned account rejected',async()=>denied(await call(banned,'snapshot')));
 await check('Owner can cancel own pending deposit',async()=>ok(await call(alice,'depositCancel',{id:requestId})));
 console.log('\n11 backend checks passed. Only the local demo database was used. Real Discord OAuth and USDC receipt verification remain untested.');
})().catch(e=>{console.error('\nFAILED:',e.message);process.exitCode=1;}).finally(async()=>{await app.delete();});
