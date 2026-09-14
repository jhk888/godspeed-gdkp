'use strict';
// Save this file inside functions/. Uses only the local database emulator.
const {test,before,after,beforeEach}=require('node:test');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const projectId='demo-godspeed-coin';
let env;
const ids={alice:'1001',bob:'1002',leader:'9001',banned:'1003'};
function db(who){if(who==='guest')return env.unauthenticatedContext().database();const id=ids[who];return env.authenticatedContext('discord_'+id,{discordId:id,raidLeader:who==='leader'}).database();}
const run={settings:{title:'Permission test'},attendance:{discord_1001:{discordId:'1001',character:'Alice'},discord_1002:{discordId:'1002',character:'Bob'},discord_1003:{discordId:'1003',character:'Banned'}},auctions:{item1:{status:'sold',currentBid:20,order:0},item2:{status:'live',currentBid:5}},settlement:{settlementMode:'coin',payoutStarted:true,setupUnlocked:false,gsPayments:{item1:{status:'paid'}},raiders:{alice:{name:'Alice',gsOwner:'1001',gsCut:10,lockedCut:10,gsCredited:0},bob:{name:'Bob',gsOwner:'1002',gsCut:10,lockedCut:10,gsCredited:0},banned:{name:'Banned',gsOwner:'1003',gsCut:10,lockedCut:10,gsCredited:0}}}};
before(async()=>{
 const rules=readFileSync(resolve(__dirname,'../database.rules.json'),'utf8');
 env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules}});
});
beforeEach(async()=>{
 await env.withSecurityRulesDisabled(async ctx=>ctx.database().ref().set({
  accounts:{1001:{gsBalance:10,tickets:{t1:{remainingUsd:10}},ledger:{l1:{unit:'GS',gsDelta:10}}},1002:{gsBalance:20}},
  bans:{discord_1003:true},gs:{config:{enabled:true}},
  runs:{active:run,archive:{...run,archived:true}}
 }));
});
after(async()=>{if(env)await env.cleanup();});
const opts={concurrency:false,timeout:15000};
test('Signed-out visitor cannot read account balances',opts,()=>assertFails(db('guest').ref('accounts/1001').once('value')));
test('Raider can read own account',opts,()=>assertSucceeds(db('alice').ref('accounts/1001').once('value')));
test('Raider cannot read another account',opts,()=>assertFails(db('alice').ref('accounts/1002').once('value')));
test('Raid leader can review accounts',opts,()=>assertSucceeds(db('leader').ref('accounts').once('value')));
test('Raider cannot directly change GS balance',opts,()=>assertFails(db('alice').ref('accounts/1001/gsBalance').set(999)));
test('Raid leader must also use backend for GS balance changes',opts,()=>assertFails(db('leader').ref('accounts/1001/gsBalance').set(999)));
test('Raider cannot create a ticket',opts,()=>assertFails(db('alice').ref('accounts/1001/tickets/new').set({remainingUsd:999})));
test('Raid leader cannot rewrite an existing GS ledger entry',opts,()=>assertFails(db('leader').ref('accounts/1001/ledger/l1').set({unit:'USD',amount:999})));
test('Raider cannot update another member attendance',opts,()=>assertFails(db('alice').ref('runs/active/attendance/discord_1002/character').set('Alice')));
test('Coin bids must use the backend',opts,()=>assertFails(db('alice').ref('runs/active/auctions/item2/currentBid').set(999)));
test('Collected auction cannot be deleted by a browser',opts,()=>assertFails(db('leader').ref('runs/active/auctions/item1').remove()));
test('Raid leader can reorder a collected auction',opts,()=>assertSucceeds(db('leader').ref('runs/active/auctions/item1/order').set(2)));
test('Locked archived payout cannot be overwritten',opts,()=>assertFails(db('leader').ref('runs/archive/settlement/raiders/alice/gsCut').set(999)));
test('Archived coin run cannot be deleted by browser',opts,()=>assertFails(db('leader').ref('runs/archive').remove()));
test('Own archived payout dispute is allowed',opts,()=>assertSucceeds(db('alice').ref('runs/archive/settlement/raiders/alice/cutRequest').set({text:'Please review'})));
test('Disputing another raider payout is denied',opts,()=>assertFails(db('alice').ref('runs/archive/settlement/raiders/bob/cutRequest').set({text:'Not mine'})));
test('Banned raider cannot read runs',opts,()=>assertFails(db('banned').ref('runs/active').once('value')));
test('Banned raider cannot submit a dispute',opts,()=>assertFails(db('banned').ref('runs/active/settlement/raiders/banned/cutRequest').set({text:'Banned request'})));
test('Changing attendance name cannot grant ownership of Bob payout',opts,async()=>{
 try{await db('alice').ref('runs/archive/attendance/discord_1001/character').set('Bob');}catch(e){if(!/permission.denied/i.test(String(e.code)+' '+e.message))throw e;}
 await assertFails(db('alice').ref('runs/archive/settlement/raiders/bob/cutRequest').set({text:'Impersonated request'}));
});
test('Unlock Setup allows RL mutator edits',opts,async()=>{
 await assertSucceeds(db('leader').ref('runs/archive/settlement/setupUnlocked').set(true));
 await assertSucceeds(db('leader').ref('runs/archive/settlement/raiders/alice/mutators').set({healer:true}));
});
test('Unlock Setup still protects the locked payout amount',opts,async()=>{
 await assertSucceeds(db('leader').ref('runs/archive/settlement/setupUnlocked').set(true));
 await assertFails(db('leader').ref('runs/archive/settlement/raiders/alice/lockedCut').set(999));
});

test('Raider cannot replace the stamped Discord owner',opts,()=>assertFails(db('alice').ref('runs/archive/settlement/raiders/bob/gsOwner').set('1001')));
test('Raid leader cannot change stamped owner after payouts lock',opts,()=>assertFails(db('leader').ref('runs/archive/settlement/raiders/bob/gsOwner').set('1001')));
test('Banned raider cannot attach dispute evidence',opts,()=>assertFails(db('banned').ref('cutDisputeAttachments/active/banned/image1').set({text:'evidence'})));
test('Owner can attach archived dispute evidence',opts,()=>assertSucceeds(db('alice').ref('cutDisputeAttachments/archive/alice/image1').set({text:'evidence'})));
test('Coin payout without stamped owner denies name fallback',opts,async()=>{
 await env.withSecurityRulesDisabled(async ctx=>ctx.database().ref('runs/archive/settlement/raiders/alice/gsOwner').remove());
 await assertFails(db('alice').ref('runs/archive/settlement/raiders/alice/cutRequest').set({text:'No owner'}));
});
