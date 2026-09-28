'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../ui/settlements.js'),'utf8');
function setup(){
 let owner='leader';const data=new Map(),ctx={accountDiscordId:()=>owner,sessionStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},settlementsDashboardRuns:{},validEthAddress:v=>/^0x[0-9a-f]{40}$/i.test(v)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const dashboardViewMemory='),source.indexOf('function dashboardActionDialog(')),ctx);
 return {ctx,data,setOwner:v=>owner=v};
}
function dialog(){
 const fields={'.dashboard-toolbar input':{value:'Raider'},'[data-dashboard-filter]':{value:'attention',options:[{value:'all'},{value:'attention'}]},'[data-dashboard-sort]':{value:'claim-oldest',options:[{value:'claim-oldest'},{value:'name'}]}};
 const disclosure=key=>({open:true,closest:()=>({getAttribute:()=>key})});
 const a=disclosure('["old","a"]'),b=disclosure('["new","b"]');
 return {dataset:{dashboardLoaded:'true',dashboardOwner:'leader'},scrollTop:420,fields,details:[a,b],querySelector:s=>fields[s],querySelectorAll:()=>[a,b]};
}
test('reopening restores filters, scroll and disclosure identity after row order changes',()=>{
 const {ctx}=setup(),d=dialog();d.details[1].open=false;ctx.dashboardRememberView(d);
 const other=dialog();other.fields['.dashboard-toolbar input'].value='';other.querySelectorAll=()=>[other.details[1],other.details[0]];
 ctx.dashboardRestoreView(other,true);ctx.dashboardRestoreView(other);
 assert.equal(other.fields['.dashboard-toolbar input'].value,'Raider');assert.equal(other.fields['[data-dashboard-filter]'].value,'attention');assert.equal(other.scrollTop,420);
 assert.equal(other.details[0].open,true);assert.equal(other.details[1].open,false);
});
test('preferences and feedback are isolated by account and survive denied storage',()=>{
 const {ctx,setOwner}=setup(),d=dialog();ctx.dashboardRememberView(d);ctx.dashboardFeedbackState().receipts.push({name:'Private'});
 setOwner('another');assert.equal(ctx.dashboardReadView().search,'');assert.equal(ctx.dashboardFeedbackState().receipts.length,0);
 ctx.sessionStorage.setItem=()=>{throw Error('denied');};d.dataset.dashboardOwner='another';assert.doesNotThrow(()=>ctx.dashboardRememberView(d));
 assert.equal(ctx.dashboardReadView().search,'Raider');
});
test('an empty loading view cannot overwrite saved scroll',()=>{
 const {ctx}=setup(),d=dialog();ctx.dashboardRememberView(d);d.scrollTop=0;d.dataset.dashboardLoaded='false';ctx.dashboardRememberView(d);assert.equal(ctx.dashboardReadView().scroll,420);
});
test('attention identifies missing destinations while completed entries remain excluded',()=>{
 const {ctx}=setup(),e={key:'run',raiderKey:'a',category:'usdc'},runs={run:{settlement:{raiders:{a:{submission:{method:'usdc',submittedAt:1,walletAddress:''}}}}}};
 assert.match(ctx.dashboardAttentionReason(e,runs),/wallet/);
 assert.equal(ctx.dashboardAttentionReason({...e,category:'paid'},runs),'');
 assert.match(ctx.dashboardAttentionReason({...e,category:'dispute'},runs),/Dispute/);
 assert.match(ctx.dashboardAttentionReason({...e,expired:true},runs),/expired/);
});
const guidance=fs.readFileSync(require.resolve('../ui/raider-guidance.js'),'utf8');
test('raider next step respects purchases, disputes, corrections and completed claims',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(guidance.slice(0,guidance.indexOf('function raiderGuidanceHTML(')),ctx);
 assert.equal(ctx.raiderNextStep({},true,'paid',false,10).action,'purchases');
 assert.equal(ctx.raiderNextStep({},true,'dispute',false,0).label,'View payout');
 assert.equal(ctx.raiderNextStep({},true,'correction',false,0).label,'Correct claim');
 assert.equal(ctx.raiderNextStep({},true,'paid',false,0).label,'View completed payout');
 assert.equal(ctx.raiderNextStep({},true,'usdc',false,0).label,'View submitted claim');
});
test('concurrent payment feedback waits for each save and only records confirmed saves',async()=>{
 let firstResolve,secondReject;
 const ctx={isRL:true,accountDiscordId:()=> 'leader',settlementsDashboardRuns:{},renderSettlementsDashboard:()=>{},toast:()=>{},hybridError:()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('function dashboardActionDialog(')),ctx);
 ctx.dashboardPaymentError=()=>{};
 ctx.dashboardSavePaid=e=>e.raiderKey==='a'?new Promise(resolve=>firstResolve=resolve):new Promise((_,reject)=>secondReject=reject);
 const a=ctx.dashboardMarkPaid({key:'run',raiderKey:'a',name:'A'}),b=ctx.dashboardMarkPaid({key:'run',raiderKey:'b',name:'B'});
 assert.equal(ctx.dashboardFeedbackState().pending,2);assert.equal(ctx.dashboardFeedbackState().receipts.length,0);
 firstResolve();await a;assert.equal(ctx.dashboardFeedbackState().pending,1);assert.equal(ctx.dashboardFeedbackState().receipts.length,1);
 secondReject(Error('network'));await b;assert.equal(ctx.dashboardFeedbackState().pending,0);assert.equal(ctx.dashboardFeedbackState().receipts.length,1);assert.equal(ctx.dashboardFeedbackState().errors.length,1);
});
