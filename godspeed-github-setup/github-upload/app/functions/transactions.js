'use strict';
// Executors clone their input. Validate against the server even when the local
// cache rejects a request, so incomplete cache data cannot cause false failures.
async function validatedTransaction(ref,execute){
 let result,error;
 const tx=await ref.transaction(current=>{
  result=undefined;error=undefined;
  try{const out=execute(current);result=out.result;return out.root;}
  catch(e){error=e;return current;}
 },undefined,false);
 if(!tx.committed)throw Error('Transaction conflicted; retry');
 if(error)throw error;
 return result;
}
module.exports={validatedTransaction};


// These operations never move balances or tickets. Their authoritative inputs
// live in one run; keep their receipt in the same atomic transaction.
const runOperations=new Set(['submitClaim','payoutChoice','claimAdmin','payoutRate','runSettings','currencies','mode']);
function executeRunCommand(run,actor,op,data,id,config,legacyReceipt,now=Date.now(),preparedImage){
 if(!runOperations.has(op))throw Error('Operation requires financial transaction');
 if(!run)throw Error('Run not found');
 const {execute}=require('./core');
 const receipt=run.commandReceipts?.[id]||legacyReceipt;
 const input={gs:{config,ops:receipt?{[id]:receipt}:{}},runs:{[data.runId]:run}};
 const out=execute(input,actor,op,data,id,now,preparedImage),updated=out.root.runs[data.runId];
 updated.commandReceipts={...(updated.commandReceipts||{}),[id]:out.root.gs.ops[id]};
 return {root:updated,result:out.result};
}
module.exports.runOperations=runOperations;
module.exports.executeRunCommand=executeRunCommand;
