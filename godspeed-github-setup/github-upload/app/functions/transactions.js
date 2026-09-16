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
