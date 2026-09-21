'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {execute,balance,units}=require('../functions/core');
const {executeRunCommand}=require('../functions/transactions');
const leader={id:'123',rl:true},member={id:'456',rl:false},now=10000;
function fixture(method='gold'){
 return {gs:{config:{enabled:true,houseId:'123',accountingMode:'manual',memberGCEnabled:true}},accounts:{123:{usdReserved:12},_run_r:{gsBalance:12,ledger:{seed:{unit:'GS',gsDelta:12}},tickets:{seed:{id:'seed',createdAt:1,remainingUsd:12,rateUsdPer1000:6}}}},runs:{r:{attendance:{a:{character:'Álice',discordId:'456'}},settlement:{settlementMode:'mixed',payoutStarted:true,claimDeadline:now+1000,payoutUsdPer1000:6,payoutMethods:{gold:true,usd:true,gc:true},raiders:{a:{name:'Álice',gsOwner:'456',gsCut:12,gsPayoutMethod:method},b:{name:'Other',submission:{imageData:'old proof'}}}}},archive:{privateImage:'x'.repeat(1000000)}},audit:{older:{entry:{ts:1}}}};
}
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze);}return x;}
const pay=method=>({runId:'r',raiderKey:'a',expectedMethod:method,expectedAmount:12,...(method==='gold'?{goldDelivered:true,expectedGold:2000,expectedPayoutRate:6}:method==='usd'?{externalPaid:true}:{})});
for(const method of ['gold','usd','gs'])test('purchase '+method+' collection and refund leave frozen inputs unchanged',()=>{
 const root=fixture();root.runs.r.settlement.payoutStarted=false;root.runs.r.settlement.usdPer1000=6;root.runs.r.settlement.acceptedCurrencies={gold:true,usd:true,gc:true};
 root.runs.r.auctions={item:{status:'sold',currentBid:12,bids:{win:{amount:12,discordId:'456',ts:1}}}};
 root.accounts[456]=root.accounts._run_r;delete root.accounts._run_r;
 const actor=method==='gs'?member:leader,data={runId:'r',auctionId:'item',method,externalReceived:true,expectedAmount:12};
 const original=freeze(root),paid=execute(original,actor,'payWin',data,'collect_0001',now).root;
 assert.equal(original.runs.r.auctions.item.paid,undefined);
 assert.equal(paid.runs.archive,original.runs.archive);assert.equal(balance(paid.accounts._run_r),12000000);
 const refunded=execute(freeze(paid),leader,'refundWin',{runId:'r',auctionId:'item',goldReturned:true,externalReturned:true},'refund_00001',now).root;
 assert.equal(paid.runs.r.settlement.gsPayments.item.status,'paid');
 assert.equal(refunded.runs.r.settlement.gsPayments.item.status,'refunded');
 assert.equal(refunded.accounts[456].gsBalance,12);assert.equal(balance(refunded.accounts._run_r),0);
 assert.equal(Object.values(refunded.accounts).reduce((sum,a)=>sum+balance(a),0),units(refunded.accounts[123].usdReserved));
});
for(const method of ['gold','usd','gs'])test('fast '+method+' payout preserves input, archives and atomic balances',()=>{
 const original=freeze(fixture(method)),data=pay(method),out=execute(original,leader,'creditCut',data,'payment_0001',now),s=out.root;
 assert.equal(original.runs.r.settlement.raiders.a.paid,undefined);
 assert.equal(original.accounts._run_r.tickets.seed.remainingUsd,12);
 assert.equal(s.runs.archive,original.runs.archive);
 assert.equal(s.runs.r.settlement.raiders.b,original.runs.r.settlement.raiders.b);
 assert.equal(s.audit.older,original.audit.older);
 assert.equal(s.runs.r.settlement.raiders.a.paid,true);
 assert.equal(balance(s.accounts._run_r),0);
 assert.equal(s.accounts._run_r.tickets.seed.remainingUsd,0);
 assert.equal(Object.values(s.accounts).reduce((sum,a)=>sum+balance(a),0),units(s.accounts[123].usdReserved));
 if(method==='gs')assert.equal(balance(s.accounts[456]),12000000);
 assert.deepEqual(execute(freeze(s),leader,'creditCut',data,'payment_0001',now+100),out);
 assert.throws(()=>execute(s,leader,'creditCut',data,'payment_0002',now),/outstanding/);
 assert.throws(()=>execute(original,leader,'creditCut',{...data,expectedAmount:13},'payment_0003',now),/amount changed/);
 assert.throws(()=>execute(original,member,'creditCut',data,'payment_0004',now),/leader/);
 if(method==='gold')assert.throws(()=>execute(original,leader,'creditCut',{...data,expectedPayoutRate:5},'payment_0005',now),/rate changed/);
});
test('claim choice, submission, correction and scoped replay never mutate snapshots',()=>{
 const original=freeze(fixture()),choice={runId:'r',raiderKey:'a',method:'usd'};
 const changed=execute(original,member,'payoutChoice',choice,'choice_00001',now).root;
 assert.equal(original.runs.r.settlement.raiders.a.gsPayoutMethod,'gold');
 const claim={...choice,walletAddress:'0x'+'1'.repeat(40)};
 const submitted=execute(freeze(changed),member,'submitClaim',claim,'claim_000001',now).root;
 const corrected=execute(freeze(submitted),leader,'claimAdmin',{runId:'r',raiderKey:'a',action:'correction',note:'Check address'},'correct_0001',now).root;
 assert.equal(submitted.runs.r.settlement.raiders.a.submission.status,'submitted');
 assert.equal(corrected.runs.r.settlement.raiders.a.submission.status,'correction');
 const run=original.runs.r,config=original.gs.config;
 const first=executeRunCommand(run,member,'payoutChoice',choice,'choice_00002',config,null,now);
 assert.deepEqual(executeRunCommand(freeze(first.root),member,'payoutChoice',choice,'choice_00002',config,null,now+1),first);
});
const client=fs.readFileSync(require.resolve('../client.js'),'utf8');
test('Gold confirmation uses loaded rate immediately, retaining legacy quote fallback',async()=>{
 const start=client.indexOf('gsCredit=async function(key,immediate=false){'),end=client.indexOf('\n',start);
 const calls=[],actions=[],context={settlement:fixture().runs.r.settlement,settlementRunKey:()=> 'r',gsCall:async(op,data)=>{calls.push(op);return {gold:2000,payoutRate:null};},gsAction:(...args)=>actions.push(args),toast:()=>{},gcMoney:String};
 vm.createContext(context);vm.runInContext(client.slice(start,end),context);
 const task=context.gsCredit('a');assert.equal(actions.length,1);await task;
 assert.equal(calls.length,0);assert.equal(actions[0][1].expectedGold,2000);assert.equal(actions[0][1].expectedPayoutRate,6);
 delete context.settlement.payoutUsdPer1000;await context.gsCredit('a');assert.deepEqual(calls,['quoteGold']);
});
test('different raiders save concurrently; duplicate same-raider confirmation is ignored',async()=>{
 const start=client.indexOf('const fastActionPending=new Set();'),end=client.indexOf('};window.gsAction=gsAction;',start)+'};window.gsAction=gsAction;'.length;
 const waits=[],calls=[],context={gsBusy:false,window:{scrollY:0,scrollTo:()=>{}},accountDiscordId:()=> '123',document:{getElementById:()=>null,querySelector:()=>null},gsCall:(op,data)=>{calls.push(data.raiderKey);return new Promise(resolve=>waits.push(resolve));},renderMain:()=>{},toast:()=>{}};
 vm.createContext(context);vm.runInContext(client.slice(start,end),context);
 const one=context.gsAction('creditCut',{runId:'r',raiderKey:'a'}),two=context.gsAction('creditCut',{runId:'r',raiderKey:'b'});
 await context.gsAction('creditCut',{runId:'r',raiderKey:'a'});
 assert.deepEqual(calls,['a','b']);assert.equal(context.gsBusy,false);
 waits.forEach(resolve=>resolve({ok:true}));await Promise.all([one,two]);
 const retry=context.gsAction('creditCut',{runId:'r',raiderKey:'a'});assert.equal(calls.length,3);waits.at(-1)({ok:true});await retry;
});
