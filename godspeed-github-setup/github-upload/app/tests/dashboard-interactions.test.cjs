'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../ui/settlements.js'),'utf8');
function setup(runs={}){
 const calls=[],errors=[],ctx={isRL:true,user:'Leader',db:{},accountDiscordId:()=> 'leader',settlementsDashboardRuns:runs,settlementsDashboardEntries:[],renderSettlementsDashboard:()=>calls.push(['render']),toast:()=>{},hybridError:e=>errors.push(e),ref:(_,path)=>path,push:()=>({key:'event-1'}),attendanceCharacterIdentity:n=>n.toLowerCase(),settlementWinner:a=>Object.values(a.bids||{}).sort((a,b)=>b.amount-a.amount)[0]?.bidder||'',fastPayoutCallOriginal:async(...args)=>calls.push(args),gsCall:async(...args)=>{calls.push(args);return {gold:1234,payoutRate:null};}};
 ctx.runTransaction=async(path,fn,options)=>{calls.push(['transaction',path,options]);const key=path.split('/')[1],run=fn(structuredClone(runs[key]));return {committed:true,snapshot:{val:()=>run}};};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('function dashboardActionDialog(')),ctx);ctx.dashboardPaymentError=e=>errors.push(e);return {ctx,calls,errors};
}
const coin=(method='usd')=>({settlement:{settlementMode:'coin',payoutStarted:true,payoutMethods:{usd:true,gold:true,gc:true},payoutUsdPer1000:5,raiders:{same:{name:'Raider',gsPayoutMethod:method,gsCut:20,gsCredited:3}}}});
const legacy=()=>({archived:true,settlement:{payoutStarted:true,usdPer1000:5,raiders:{same:{name:'Raider',lockedCut:2000,cutAdjustments:{a:{amount:100},b:{amount:500,reversedAt:1}},submission:{method:'usdc',submittedAt:1}}}},auctions:{sold:{status:'sold',bids:{b:{bidder:'Raider',amount:100}}},other:{status:'sold',bids:{b:{bidder:'Else',amount:100}}}}});
const entry={key:'archive',raiderKey:'same',name:'Raider'};
test('cross-run USDC paid command uses the archive, not the current run with the same raider key',async()=>{
 const {ctx,calls}=setup({archive:coin(),current:coin('gold')});await ctx.dashboardSavePaid(entry);
 const command=calls.find(c=>c[0]==='creditCut');assert.equal(command[1].runId,'archive');assert.equal(command[1].expectedMethod,'usd');assert.equal(command[1].expectedAmount,17);assert.equal(command[1].externalPaid,true);
});
test('gold command uses its own run rate and confirms delivery; missing rate uses its own quote',async()=>{
 const run=coin('gold'),{ctx,calls}=setup({archive:run});await ctx.dashboardSavePaid(entry);assert.equal(calls[0][1].expectedGold,3400);assert.equal(calls[0][1].expectedPayoutRate,5);assert.equal(calls[0][1].goldDelivered,true);
 delete run.settlement.payoutUsdPer1000;calls.length=0;await ctx.dashboardSavePaid(entry);assert.equal(calls[0][0],'quoteGold');assert.equal(calls[0][1].runId,'archive');assert.equal(calls[1][1].expectedGold,1234);
});
test('GC command uses creditCut and does not claim an external transfer',async()=>{
 const {ctx,calls}=setup({archive:coin('gs')});await ctx.dashboardSavePaid(entry);assert.equal(calls[0][0],'creditCut');assert.equal(calls[0][1].expectedMethod,'gs');assert.equal(calls[0][1].externalPaid,undefined);
});
test('legacy transaction records fixed cut, rate, audit event and linked items in the selected run',async()=>{
 const run=legacy(),{ctx,calls}=setup({archive:run});await ctx.dashboardSavePaid(entry);assert.equal(calls[0][1],'runs/archive');assert.equal(calls[0][2].applyLocally,false);
 const paid=ctx.dashboardLegacyPayment(run,'same',{cut:2100,method:'usdc',rate:5},'p','Leader',123);
 assert.equal(paid.settlement.raiders.same.paid,true);assert.equal(paid.settlement.raiders.same.paidAmount,2100);assert.equal(paid.settlement.raiders.same.payoutEvents.p.usdcAmount,10.5);assert.equal(paid.auctions.sold.paid,true);assert.equal(paid.auctions.other.paid,undefined);assert.equal(paid.settlement.payments.sold.settled,true);
 ctx.dashboardLegacyPayment(run,'same',{cut:2100,method:'usdc',rate:5},'duplicate','Leader',124);assert.equal(Object.keys(run.settlement.raiders.same.payoutEvents).length,1);
});
test('legacy concurrent amount or method changes reject without recording payment',()=>{
 const {ctx}=setup();for(const expected of [{cut:2000,method:'usdc',rate:5},{cut:2100,method:'gold',rate:5},{cut:2100,method:'usdc',rate:10}]){const run=legacy();assert.throws(()=>ctx.dashboardLegacyPayment(run,'same',expected,'p','Leader',1),/changed/);assert.equal(run.settlement.raiders.same.paid,undefined);}
});
test('legacy reopen retains history and returns linked items to unpaid; GC cannot be silently reversed',async()=>{
 const {ctx}=setup({archive:coin()});await assert.rejects(ctx.dashboardSavePaid(entry,true),/cannot be undone/);const run=legacy(),expected={cut:2100,method:'usdc',rate:5};ctx.dashboardLegacyPayment(run,'same',expected,'p','Leader',1);ctx.dashboardLegacyPayment(run,'same',expected,'r','Leader',2,true);assert.equal(run.settlement.raiders.same.paid,false);assert.equal(Object.keys(run.settlement.raiders.same.payoutEvents).length,2);assert.equal(run.auctions.sold.paid,false);
});
test('row hides synchronously, duplicate clicks issue one save, successful save stays hidden until snapshot',async()=>{
 const run=coin(),{ctx,calls}=setup({archive:run});let resolve;ctx.fastPayoutCallOriginal=()=>{calls.push(['save']);return new Promise(r=>resolve=r);};
 const pending=ctx.dashboardMarkPaid(entry);assert.equal(ctx.dashboardPaymentPending(entry),true);await ctx.dashboardMarkPaid(entry);assert.equal(calls.filter(c=>c[0]==='save').length,1);resolve();await pending;assert.equal(ctx.dashboardPaymentPending(entry),true);Object.assign(run.settlement.raiders.same,{paid:true,gsCredited:20});assert.equal(ctx.dashboardPaymentPending(entry),false);
});
test('failure restores row and reports error without navigation; non-leaders cannot pay',async()=>{
 const {ctx,errors}=setup({archive:coin()});ctx.fastPayoutCallOriginal=async()=>{throw Error('Denied');};await ctx.dashboardMarkPaid(entry);assert.equal(ctx.dashboardPaymentPending(entry),false);assert.match(errors[0],/restored.*Denied/);ctx.isRL=false;await assert.rejects(ctx.dashboardSavePaid(entry),/Leader/);
});

function navigation(){
 const windows=[],events={},observers=[],stack=[null];let position=0;
 const history={state:null,replaceState(s){this.state=s;stack[position]=s;},pushState(s){stack.splice(++position);stack[position]=s;this.state=s;},go(n){position+=n;this.state=stack[position];this.pending=events.popstate({state:this.state});}};
 const ctx={crypto:{randomUUID:()=> 'session'},history,window:{addEventListener:(name,fn)=>events[name]=fn},document:{body:{},querySelectorAll:()=>windows.filter(w=>w.isConnected),addEventListener(){}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},getComputedStyle:()=>({visibility:'visible'}),openDashboardSettlement(){},accountDiscordId:()=> 'leader',settlementRunKey:()=> 'current'};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../ui/navigation.js'),'utf8'),ctx);
 const add=(id)=>{const w={id,dataset:{},tagName:'DIALOG',hidden:false,isConnected:true,classList:{contains:()=>false},getClientRects:()=>[{}],close(){},remove(){this.isConnected=false;}};windows.push(w);ctx.uiHistorySync();return w;};
 return {ctx,history,add,windows,depth:()=>history.state.gdkpWindows.depth,back:async()=>{history.go(-1);await history.pending;}};
}
test('Back closes attachment first, then parent window, with same-URL history entries',async()=>{
 const n=navigation(),parent=n.add('parent'),child=n.add('child');assert.equal(n.depth(),2);await n.back();assert.equal(child.isConnected,false);assert.equal(parent.isConnected,true);assert.equal(n.depth(),1);await n.back();assert.equal(parent.isConnected,false);assert.equal(n.depth(),0);
});
test('rerenders do not add history; explicit Close consumes its entry',async()=>{
 const n=navigation(),parent=n.add('parent');n.ctx.uiHistorySync();n.ctx.uiHistorySync();assert.equal(n.depth(),1);parent.remove();n.ctx.uiHistorySync();await n.history.pending;assert.equal(n.depth(),0);
});
test('disclosure state is scoped to the run and stable row identity',()=>{
 const n=navigation(),row={getAttribute:()=> 'raider-a'},root={id:'settlements-dashboard'},details={id:'',closest:s=>s.startsWith('dialog')?root:s.startsWith('[data')?row:null,querySelector:()=>({textContent:'View claim details'})};
 const key=n.ctx.uiDisclosureKey(details);row.getAttribute=()=> 'raider-b';assert.notEqual(n.ctx.uiDisclosureKey(details),key);row.getAttribute=()=> 'raider-a';assert.equal(n.ctx.uiDisclosureKey(details),key);
});
