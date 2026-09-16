'use strict';
const {execute}=require('./core');
// Keep auction, attendance, currency terms and request receipt in one run transaction.
// Global service/ban authorization is checked by the callable before entering here.
function executeRunBid(run,actor,data,id,config,legacyReceipt,now=Date.now()){
 if(!run)throw Error('Run not found');
 const receipt=run.bidOperations?.[id]||legacyReceipt;
 const out=execute({runs:{[data.runId]:run},gs:{config,ops:receipt?{[id]:receipt}:{}}},actor,'placeBid',data,id,now);
 const next=out.root.runs[data.runId];
 next.bidOperations??={};next.bidOperations[id]=out.root.gs.ops[id];
 return {root:next,result:out.result};
}
module.exports={executeRunBid};
