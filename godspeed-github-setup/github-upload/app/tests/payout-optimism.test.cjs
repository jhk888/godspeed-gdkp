'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../client.js'),'utf8');
function setup(){
 let resolve,reject;const errors=[],credits=[],r={key:'a',gsCut:12,gsCredited:0,paid:false};
 const ctx={owner:'123',run:'r',tab:'settlement',settlement:{raiders:{a:r}},window:{scrollY:240,scrollTo:()=>{}},document:{createElement:()=>({}),head:{append(){}}},accountDiscordId:()=>ctx.owner,settlementRunKey:()=>ctx.run,payoutQueueCategory:()=> 'ready',gsPayoutQueue:()=>'',setPayoutPaid:()=>{},gsContext:()=>true,gsCredit:(...args)=>credits.push(args),renderMain:()=>{},hybridError:message=>errors.push(message),gsCall:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('// Hide a checked payout while saving')),ctx);
 return {ctx,r,errors,credits,resolve:()=>resolve({ok:true}),reject:()=>reject(Error('Connection lost'))};
}
test('checkbox initiates payment without a second confirmation',()=>{
 const {ctx,credits}=setup();ctx.setPayoutPaid('a',true);assert.deepEqual(credits,[['a',true]]);
});
test('row hides before network work; successful save stays hidden until snapshot arrives',async()=>{
 const app=setup(),{ctx,r}=app;const work=ctx.gsCall('creditCut',{runId:'r',raiderKey:'a'});
 assert.equal(ctx.fastPayoutHidden(r),true);assert.equal(r.paid,false);assert.equal(r.gsCredited,0);
 ctx.setPayoutPaid('a',true);assert.equal(app.credits.length,0);
 await Promise.resolve();app.resolve();await work;assert.equal(ctx.fastPayoutHidden(r),true);
 r.gsCut=13;assert.equal(ctx.fastPayoutHidden(r),false,'additional cut must become visible');
});
test('failed save restores row and keeps error visible without marking paid',async()=>{
 const app=setup(),{ctx,r}=app,work=ctx.gsCall('creditCut',{runId:'r',raiderKey:'a'});
 const rejection=assert.rejects(work,/Connection lost/);await Promise.resolve();app.reject();await rejection;
 assert.equal(ctx.fastPayoutHidden(r),false);assert.equal(r.paid,false);assert.match(app.errors[0],/row has been restored/);
});
test('pending state is isolated to the account and run',async()=>{
 const app=setup(),{ctx,r}=app,work=ctx.gsCall('creditCut',{runId:'r',raiderKey:'a'});
 ctx.run='another';assert.equal(ctx.fastPayoutHidden(r),false);ctx.run='r';ctx.owner='456';assert.equal(ctx.fastPayoutHidden(r),false);
 await Promise.resolve();app.resolve();await work;assert.equal(ctx.fastPayoutHidden(r),false);
});
