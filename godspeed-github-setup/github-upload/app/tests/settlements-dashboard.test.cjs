'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base=fs.readFileSync(require.resolve('../source/base.html'),'utf8'),client=fs.readFileSync(require.resolve('../client.js'),'utf8');
function setup(){
 const ctx={payoutSafeImage:v=>v,validEthAddress:v=>/^0x[0-9a-f]{40}$/i.test(v),gsAmount:v=>v+' GC',usdText:v=>'$'+v.toFixed(2)};vm.createContext(ctx);
 vm.runInContext(base.slice(base.indexOf('function collectSettlementTasks('),base.indexOf('function closeSettlementsDashboard(')),ctx);
 vm.runInContext('const gsOldTasks=collectSettlementTasks;'+client.slice(client.indexOf('function gcClaimCategory('),client.indexOf('const claimStatusOriginal='))+client.slice(client.indexOf('collectSettlementTasks=function(runs,currentKey){'),client.indexOf('\ngsPayoutQueue=function',client.indexOf('collectSettlementTasks=function(runs,currentKey){'))),ctx);
 vm.runInContext(base.slice(base.indexOf('function dashboardMatches('),base.indexOf('function renderSettlementsDashboard(')),ctx);return ctx;
}
const now=Date.now();
const raider=(name,extra={})=>({name,gsCut:10,gsCredited:0,gsPayoutMethod:'usd',...extra});
const run=(raiders,extra={})=>({createdAt:now-300000,settings:{raidTitle:'Archived raid'},settlement:{settlementMode:'coin',payoutStarted:true,payoutStartedAt:now-72*3600000,payoutMethods:{usd:true,gold:true,gc:true},payoutUsdPer1000:5,raiders},...extra});
test('includes current, archived, and older unarchived settlements; omits deleted runs',()=>{
 const c=setup(),data={current:run({a:raider('A')}),archived:run({b:raider('B')},{archived:true}),older:run({c:raider('C')}),deleted:run({d:raider('D')},{deletedAt:now})};
 const entries=c.collectSettlementTasks(data,'current');assert.deepEqual(Array.from(entries,e=>e.name),['A','B','C']);assert.equal(entries.filter(e=>c.dashboardMatches(e,'expired')).length,3);
});
test('claim extensions and submitted claims use the owning run deadline',()=>{
 const image='data:image/png;base64,AAAA',submittedAt=now-5000,c=setup(),data={a:run({expired:raider('Expired'),extended:raider('Extended',{claimExtensionUntil:now+3600000}),ready:raider('Ready',{submission:{method:'usd',submittedAt,walletAddress:'0x'+'a'.repeat(40),seller:'Seller',item:'Item',imageData:image}})},{archived:true})};
 const entries=c.collectSettlementTasks(data,'other'),ready=entries.find(e=>e.name==='Ready');assert.deepEqual(Array.from(entries.filter(e=>e.expired),e=>e.name),['Expired']);assert.equal(ready.category,'usdc');assert.equal(ready.submittedAt,submittedAt);assert.equal(ready.walletAddress,'0x'+'a'.repeat(40));assert.equal(ready.seller,'Seller');assert.equal(ready.item,'Item');assert.equal(ready.imageData,image);
});
test('paid filter preserves history while open filter excludes completed entries; disputes remain actionable',()=>{
 const c=setup(),data={a:run({paid:raider('Paid',{paid:true,gsCredited:10}),dispute:raider('Dispute',{paid:true,gsCredited:10,cutRequest:{status:'open'}})},{archived:true})};
 const entries=c.collectSettlementTasks(data,'a');assert.equal(entries.filter(e=>c.dashboardMatches(e,'paid')).length,1);assert.equal(entries.filter(e=>c.dashboardMatches(e,'all')).length,1);assert.equal(entries.find(e=>e.name==='Dispute').category,'dispute');
});
test('gold and USDC amounts follow payout method; sorting uses a common USD equivalent',()=>{
 const c=setup(),entries=c.collectSettlementTasks({a:run({gold:raider('Gold',{gsPayoutMethod:'gold'}),usd:raider('USD')})},'a');assert.equal(entries.find(e=>e.name==='Gold').amount,'2,000g');assert.equal(entries.find(e=>e.name==='USD').amount,'10.00 USDC');assert.equal(entries[0].sortAmount,entries[1].sortAmount);
});
test('legacy expired and paid settlements are included with correct amounts',()=>{
 const c=setup(),entries=c.collectSettlementTasks({old:{archived:true,settlement:{payoutStarted:true,claimDeadline:now-1000,usdPer1000:5,raiders:{a:{name:'Legacy',lockedCut:2000},b:{name:'Paid',lockedCut:3000,paid:true,paidAmount:3000}}}}},'current');
 assert.equal(entries.find(e=>e.name==='Legacy').expired,true);assert.equal(entries.find(e=>e.name==='Paid').amount,'3,000g');assert.equal(entries.find(e=>e.name==='Legacy').sortAmount,10);
});

test('paid gold displays the recorded delivery after the run rate changes',()=>{
 const c=setup(),entries=c.collectSettlementTasks({a:run({gold:raider('Gold',{gsPayoutMethod:'gold',paid:true,gsCredited:10,payoutEvents:{p:{type:'paid',method:'gold',goldAmount:1250}}})})},'a');assert.equal(entries[0].amount,'1,250g');
});
test('dashboard exposes claim expansion, elapsed time, paid checkbox, and payout actions',()=>{
 assert.match(base,/Open Payouts/);assert.match(base,/settlementElapsedText/);assert.match(base,/data-dashboard-proof/);assert.match(base,/data-dashboard-paid/);assert.match(base,/data-dashboard-action/);assert.match(base,/Modify cut/);assert.match(base,/Re-open paid cut/);
});
