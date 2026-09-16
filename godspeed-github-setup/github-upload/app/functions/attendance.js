'use strict';
const crypto=require('node:crypto');
const ops=new Set(['attendanceSettings','attendanceVerify','attendanceJoin','attendanceLeave','attendancePreference','attendanceArchive','migrateAttendanceCodes']);
const need=(ok,msg)=>{if(!ok)throw Error(msg);};
const norm=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
function newCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');}
function executeAttendance(input,actor,op,data,now=Date.now(),proposedCode=newCode()){
 const root=structuredClone(input||{});
 need(/^\d+$/.test(actor.id)&&!root.bans?.['discord_'+actor.id],'Verified, unbanned Discord identity required');
 need(ops.has(op),'Unknown attendance operation');
 root.attendanceSecrets??={};root.attendanceAttempts??={};
 const leader=()=>need(actor.rl===true,'Raid leader required');
 const migrate=(id,r)=>{if(r.attendanceSettings?.code){root.attendanceSecrets[id]??={code:String(r.attendanceSettings.code).trim().toUpperCase()};delete r.attendanceSettings.code;}};
 if(op==='migrateAttendanceCodes'){leader();for(const [id,r] of Object.entries(root.runs||{}))migrate(id,r);return {root,result:{ok:true}};}
 const key='discord_'+actor.id;
 const allowAttempt=()=>{let a=root.attendanceAttempts[actor.id];if(!a||now-a.since>=60000)a=root.attendanceAttempts[actor.id]={since:now,count:0};if(a.count>=10)return false;a.count++;return true;};
 if(op==='attendanceArchive'){
  if(!allowAttempt())return{root,result:{error:'Too many attempts. Wait one minute.'}};
  const code=String(data.code||'').trim().toUpperCase();
  const matches=Object.entries(root.runs||{}).filter(([id,r])=>r.archived&&code&&root.attendanceSecrets[id]?.code===code&&Object.values(r.attendance||{}).some(a=>String(a.discordId)===actor.id)).sort((a,b)=>(b[1].archivedAt||0)-(a[1].archivedAt||0));
  return{root,result:matches.length?{runId:matches[0][0]}:{error:'No archived payout for your account matches that code'}};
 }
 need(typeof data.runId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(data.runId),'Invalid run');
 const run=root.runs?.[data.runId];need(run,'Run not found');
 if(op==='attendanceSettings'){
  leader();migrate(data.runId,run);run.attendanceSettings??={};
  if(data.open!==undefined){need(typeof data.open==='boolean','Invalid check-in setting');need(!run.archived&&!run.settlement?.payoutStarted,'Check-in is locked');run.attendanceSettings.open=data.open;run.attendanceSettings.enabled=true;run.attendanceSettings.updatedAt=now;}
  if(!root.attendanceSecrets[data.runId]?.code||data.rotate===true){root.attendanceSecrets[data.runId]={code:proposedCode,updatedAt:now};}
  return{root,result:{...run.attendanceSettings,code:root.attendanceSecrets[data.runId].code}};
 }
 need(!run.archived&&!run.settlement?.payoutStarted,'Attendance is locked for this run');
 run.attendance??={};const old=run.attendance[key];
 const hasBid=Object.values(run.auctions||{}).some(a=>Object.values(a.bids||{}).some(b=>!b.retracted&&String(b.discordId)===actor.id));
 if(op==='attendanceLeave'){need(run.attendanceSettings?.open,'Check-in is closed');need(!hasBid,'Your character is locked after bidding');delete run.attendance[key];return{root,result:{ok:true}};}
 if(op==='attendancePreference'){need(old,'Check in first');need(['usd','gold','gc'].includes(data.preference),'Invalid preference');old.purchasePreference=data.preference;old.paymentChangedAt=now;return{root,result:{ok:true}};}
 need(run.attendanceSettings?.open||actor.rl,'Check-in is closed');
 if(!actor.rl){
  if(!allowAttempt())return{root,result:{error:'Too many attempts. Wait one minute.'}};
  const expected=root.attendanceSecrets[data.runId]?.code;
  if(!expected||String(data.code||'').trim().toUpperCase()!==expected)return{root,result:{error:'Raid code does not match'}};
 }
 if(op==='attendanceVerify')return{root,result:{ok:true}};
 const character=String(data.character||'').normalize('NFKC').trim();
 need(character.length>=1&&character.length<=20&&!/[\x00-\x1f<>]/.test(character),'Enter a valid character name (1–20 characters)');
 need(!old||!hasBid||norm(old.character)===norm(character),'Your character is locked after bidding');
 need(!Object.entries(run.attendance).some(([k,a])=>k!==key&&a.approved&&norm(a.character)===norm(character)),'Character is already checked in');
 const profile=root.accounts?.[actor.id]?.profile||{};
 run.attendance[key]={...(old||{}),discordId:actor.id,discordName:profile.discordName||actor.id,personName:profile.displayName||profile.discordName||actor.id,character,purchasePreference:['usd','gold','gc'].includes(data.preference)?data.preference:'usd',approved:true,checkInSource:actor.rl?'automatic':'code',checkedInAt:old?.checkedInAt||now};
 root.audit??={};root.audit[data.runId]??={};root.audit[data.runId]['checkin_'+actor.id+'_'+now]={ts:now,type:'check-in',actor:actor.id,discordName:profile.discordName||actor.id,character};
 return{root,result:{ok:true,record:run.attendance[key]}};
}
module.exports={executeAttendance,attendanceOps:ops};
