'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../client.js'),'utf8'),start=source.indexOf('// Start the screenshot upload');
let calls=0,notice='';const image={data:'data:image/jpeg;base64,YQ=='};
const context={window:{},WeakMap,gsSnapshot:{claimImagesVersion:1},payoutDraftImage:image,accountDiscordId:()=> '456',settlementRunKey:()=> 'r',payoutCurrentRaider:()=>({key:'a'}),gsContext:()=>true,payoutAttachmentNotice:s=>notice=s,handlePayoutFile:async()=>{},payoutSafeImage:x=>/^data:image\//.test(x)?x:'',gsCall:async()=>{calls++;return {path:'claim-images/r/456/'+'a'.repeat(64)};}};
vm.createContext(context);vm.runInContext(source.slice(start),context);
(async()=>{
 await context.handlePayoutFile({});await context.handlePayoutFile({});await Promise.resolve();
 assert.equal(calls,1);assert.match(notice,/uploaded/);
 const url='https://firebasestorage.googleapis.com/v0/b/godspeed-gdkp.firebasestorage.app/o/claim-images%2Fr%2F456%2F'+'a'.repeat(64)+'?alt=media&token=abc-def';
 assert.equal(context.payoutSafeImage(url),url);assert.equal(context.payoutSafeImage(url.replace('godspeed-gdkp','other')),'');assert.equal(context.payoutSafeImage('javascript:alert(1)'),'');
 context.gsSnapshot={};context.payoutDraftImage={data:image.data};await context.handlePayoutFile({});assert.equal(calls,1);
 context.gsSnapshot={claimImagesVersion:1};context.gsCall=async()=>{throw Error('Unavailable');};await context.handlePayoutFile({});await new Promise(resolve=>setImmediate(resolve));assert.match(notice,/when you submit/);
 console.log('PASS: background upload coalescing, image URL allowlist, old backend compatibility, upload failure retains attachment');
})().catch(e=>{console.error(e);process.exitCode=1;});
