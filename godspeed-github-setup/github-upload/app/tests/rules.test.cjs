const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {ref,set,get,update,remove}=require('firebase/database');
test('production rules enforce real identity, server check-in, private codes, balances and disputes',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-godspeed-security',database:{host:'127.0.0.1',port:9105,rules:fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8')}});
 try{
 await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database()),{runs:{r:{attendanceSettings:{enabled:true,open:true},attendance:{discord_1001:{discordId:'1001',character:'Alice',approved:true}},settlement:{settlementMode:'coin',raiders:{alice:{name:'Alice',gsOwner:'1001'},bob:{name:'Bob',gsOwner:'1002'}}}},legacy:{attendance:{},settlement:{raiders:{alice:{name:'Alice'}}}}},attendanceSecrets:{r:{code:'PRIVATE'}},accounts:{1001:{gsBalance:20},1002:{gsBalance:30}},bans:{discord_1003:true}}));
 const a=env.authenticatedContext('discord_1001',{discordId:'1001'}).database();const b=env.authenticatedContext('discord_1002',{discordId:'1002'}).database();const rl=env.authenticatedContext('discord_670939357686923265',{discordId:'670939357686923265',raidLeader:true}).database();const anon=env.unauthenticatedContext().database();const banned=env.authenticatedContext('discord_1003',{discordId:'1003'}).database();
 await assertFails(get(ref(anon,'runs')));await assertFails(get(ref(banned,'runs')));await assertSucceeds(get(ref(a,'runs')));
 await assertFails(get(ref(a,'attendanceSecrets')));await assertSucceeds(get(ref(rl,'attendanceSecrets')));
 await assertFails(update(ref(a,'runs/r/attendance/discord_1001'),{approved:true}));await assertFails(set(ref(b,'runs/r/attendance/discord_1001'),{discordId:'1002',approved:true}));await assertFails(remove(ref(a,'runs/r/attendance/discord_1001')));
 await assertSucceeds(set(ref(rl,'runs/r/attendance/discord_1002'),{discordId:'1002',character:'Bob',approved:true}));
 await assertFails(set(ref(a,'accounts/1001/gsBalance'),100000));await assertFails(get(ref(a,'accounts/1002')));await assertSucceeds(get(ref(a,'accounts/1001')));
 await assertFails(set(ref(a,'runs/legacy/auctions/a/currentBid'),10));await assertFails(set(ref(a,'runs/r/auctions/a/bids/b'),{discordId:'1001',amount:10}));
 await assertFails(set(ref(rl,'runs/r/attendanceSettings/code'),'LEAK'));await assertFails(set(ref(rl,'runs/new'),{attendanceSettings:{code:'LEAK'},settlement:{settlementMode:'coin'}}));
 await assertSucceeds(set(ref(rl,'runs/new'),{attendanceSettings:{open:false},settlement:{settlementMode:'coin'}}));
 await assertSucceeds(set(ref(a,'runs/r/presence/discord_1001_session'),{discordId:'1001',isRL:false}));await assertFails(set(ref(a,'runs/r/presence/discord_1002_session'),{discordId:'1002',isRL:false}));await assertFails(set(ref(a,'runs/r/presence/discord_1001_session'),{discordId:'1001',isRL:true}));
 await assertSucceeds(set(ref(a,'runs/r/settlement/raiders/alice/cutRequest'),{reason:'Check my bonus'}));await assertFails(set(ref(a,'runs/r/settlement/raiders/bob/cutRequest'),{reason:'Impersonation'}));
 await assertSucceeds(set(ref(a,'cutDisputeAttachments/r/alice/image'),{data:'test'}));await assertFails(set(ref(a,'cutDisputeAttachments/r/bob/image'),{data:'test'}));
 const fake=env.authenticatedContext('discord_1001',{discordId:'1001',raidLeader:true}).database();await assertFails(set(ref(fake,'bans/discord_1002'),true));
 }finally{await env.cleanup();}
});
