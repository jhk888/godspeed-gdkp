'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const leader='670939357686923265',member='456';
function fixture(){return {gs:{config:{enabled:true,houseId:leader,accountingMode:'manual',memberGCEnabled:true}},accounts:{[leader]:{usdReserved:12},_run_r:{gsBalance:12,ledger:{seed:{unit:'GS',gsDelta:12}},tickets:{seed:{id:'seed',createdAt:1,remainingUsd:12,rateUsdPer1000:6}}}},runs:{r:{settlement:{settlementMode:'mixed',payoutStarted:true,payoutUsdPer1000:6,payoutMethods:{gold:true,usd:true,gc:true},raiders:{a:{name:'Álice',gsOwner:member,gsCut:12,gsPayoutMethod:'gold'}}}}}};}
const payment={runId:'r',raiderKey:'a',expectedMethod:'gold',expectedAmount:12,goldDelivered:true,expectedGold:2000,expectedPayoutRate:6};
function server(initial,{cached}={}){
 let state=structuredClone(initial),reads=0,transactions=0;const paths=[];
 const db={ref(path=''){paths.push(path);return {get:async()=>{reads++;throw Error('Unexpected preliminary database read');},transaction:async fn=>{
  assert.equal(path,'');transactions++;
  if(cached!==undefined)fn(structuredClone(cached));
  const before=structuredClone(state),next=fn(state);assert.deepEqual(state,before,'transaction must not mutate its input');
  if(next===undefined)return {committed:false};state=next;return {committed:true};
 }};}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const exported={},context={exports:exported,Buffer,console:{info(){}},require:name=>{
  if(name==='firebase-functions/v2/https')return {onCall:(o,h)=>h,onRequest:(o,h)=>h,HttpsError};
  if(name==='firebase-functions/params')return {defineSecret:()=>({value:()=>''}),defineString:(n,o)=>({value:()=>o?.default||''})};
  if(name==='firebase-admin/app')return {initializeApp(){}};
  if(name==='firebase-admin/database')return {getDatabase:()=>db};
  if(name==='firebase-admin/storage')return {getStorage(){throw Error('Unexpected storage access');}};
  if(name==='firebase-admin/auth')return {getAuth:()=>({})};
  if(name==='./core')return require('../functions/core');
  if(name==='./transactions')return require('../functions/transactions');
  if(name==='./bids')return {executeRunBid(){throw Error('unexpected bid');}};
  if(name==='./attendance')return require('../functions/attendance');
  if(name==='./discordAuth')return {createHandler:()=>()=>{}};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../functions/index'),'utf8'),context);
 return {call:(op,data,id='payment_test_01',user=leader,rl=user===leader)=>exported.gsCommand({auth:{uid:'discord_'+user,token:{discordId:user,raidLeader:rl}},data:{op,data,id}}),state:()=>state,stats:()=>({reads,transactions,paths})};
}
test('payout saves and retries perform no preliminary reads or duplicate debit',async()=>{
 const app=server(fixture(),{cached:null});await app.call('creditCut',payment);
 assert.equal(app.state().runs.r.settlement.raiders.a.paid,true);
 assert.equal(app.state().accounts._run_r.gsBalance,0);
 const saved=structuredClone(app.state());await app.call('creditCut',payment);assert.deepEqual(app.state(),saved);
 assert.deepEqual(app.stats(),{reads:0,transactions:2,paths:['','']});
});
test('ban checks precede replay and are repeated against the committed snapshot',async()=>{
 for(const ban of [false,{reason:'blocked'}]){
  const root=fixture();root.bans={['discord_'+leader]:ban};const before=structuredClone(root);
  const app=server(root,{cached:fixture()});await assert.rejects(app.call('creditCut',payment),e=>e.code==='permission-denied');assert.deepEqual(app.state(),before);
 }
 const app=server(fixture());await app.call('creditCut',payment);app.state().bans={['discord_'+leader]:true};
 await assert.rejects(app.call('creditCut',payment),e=>e.code==='permission-denied');
});
test('paused site blocks member payment inside transaction; leader privileges remain checked',async()=>{
 const root=fixture();root.gs.config.sitePaused=true;const app=server(root,{cached:fixture()});
 await assert.rejects(app.call('payWin',{runId:'r',auctionId:'item'},'purchase_0001',member),e=>e.code==='unavailable');
 await assert.rejects(app.call('creditCut',payment,'payment_00002',member,true),e=>e.code==='unavailable');
 assert.deepEqual(app.state(),root);await app.call('creditCut',payment);assert.equal(app.state().runs.r.settlement.raiders.a.paid,true);
});
test('purchase collection and refund preserve funding without preliminary reads',async()=>{
 const root=fixture();root.runs.r.settlement.payoutStarted=false;root.runs.r.settlement.usdPer1000=6;root.runs.r.settlement.acceptedCurrencies={gold:true,usd:true,gc:true};
 root.runs.r.auctions={item:{status:'sold',currentBid:12,bids:{win:{amount:12,discordId:member,ts:1}}}};
 root.accounts[member]=root.accounts._run_r;delete root.accounts._run_r;const app=server(root);
 await app.call('payWin',{runId:'r',auctionId:'item',method:'gs'},'purchase_0001',member);
 assert.equal(app.state().accounts[member].gsBalance,0);assert.equal(app.state().accounts._run_r.gsBalance,12);
 await app.call('refundWin',{runId:'r',auctionId:'item'},'refund_00001');assert.equal(app.state().accounts[member].gsBalance,12);
 assert.equal(app.stats().reads,0);
});
test('method, amount and role validation remain active in the accelerated path',async()=>{
 const app=server(fixture());
 await assert.rejects(app.call('creditCut',{...payment,expectedAmount:13}),/amount changed/);
 await assert.rejects(app.call('creditCut',{...payment,expectedPayoutRate:5}),/rate changed/);
 await assert.rejects(app.call('creditCut',payment,'payment_00003',member,true),/leader/);
 assert.deepEqual(app.state(),fixture());assert.equal(app.stats().reads,0);
});
