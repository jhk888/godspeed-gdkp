'use strict';
const {JsonRpcProvider,Interface}=require('ethers');
const USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const abi=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
async function provider(rpc){const p=new JsonRpcProvider(rpc);if(Number((await p.getNetwork()).chainId)!==1)throw Error('Ethereum mainnet RPC required');return p;}
function eventOf(log,block){const e=abi.parseLog(log);return {verified:true,id:'eth_'+log.transactionHash.slice(2)+'_'+log.index,chainId:1,hash:log.transactionHash,logIndex:log.index,from:e.args.from.toLowerCase(),to:e.args.to.toLowerCase(),amount:Number(e.args.value)/1e6,blockNumber:log.blockNumber,blockHash:log.blockHash,blockTime:block.timestamp*1000};}
async function receipt(rpc,hash,index,confirmations=12){
  if(!/^0x[a-fA-F0-9]{64}$/.test(String(hash))||!Number.isInteger(index)||index<0)throw Error('Enter hash and log index');
  const p=await provider(rpc);try{const r=await p.getTransactionReceipt(hash);if(!r||r.status!==1)throw Error('Successful receipt not found');if((await p.getBlockNumber())-r.blockNumber+1<Math.max(12,confirmations))throw Error('Waiting for confirmations');const log=r.logs.find(l=>l.index===index&&l.address.toLowerCase()===USDC);if(!log)throw Error('USDC Transfer log not found');const block=await p.getBlock(r.blockNumber);if(block.hash!==r.blockHash)throw Error('Chain changed; retry');return eventOf(log,block);}finally{p.destroy();}
}
async function scan({rpc,cfg,db,credit}){
  const p=await provider(rpc);try{
    const final=(await p.getBlockNumber())-Math.max(12,cfg.confirmations)+1;
    const cursor=(await db.ref('gs/watchBlock').get()).val();
    if(cursor==null){await db.ref('gs/watchBlock').set(final);return;}
    const end=Math.min(final,cursor+500);if(end<=cursor)return;
    const topic=abi.getEvent('Transfer').topicHash,to='0x'+cfg.address.slice(2).padStart(64,'0');
    const logs=await p.getLogs({address:USDC,fromBlock:cursor+1,toBlock:end,topics:[topic,null,to]});
    for(const log of logs){const block=await p.getBlock(log.blockNumber),ev=eventOf(log,block);if((await db.ref('gs/chainEvents/'+ev.id).get()).exists())continue;
      const deposits=(await db.ref('gs/deposits').get()).val()||{};
      const matches=Object.entries(deposits).filter(([,d])=>d.status==='pending'&&d.address===ev.to&&Math.round(d.amount*1e6)===Math.round(ev.amount*1e6)&&d.createdAt<=ev.blockTime+60000&&d.expiresAt>=ev.blockTime);
      if(matches.length===1){try{await credit(matches[0][0],ev);}catch(e){await db.ref('gs/unmatched/'+ev.id).set({...ev,error:String(e.message).slice(0,200)});}}
      else await db.ref('gs/unmatched/'+ev.id).set({...ev,reason:matches.length?'Ambiguous request':'No exact request'});
    }
    // Concurrent invocations never move the cursor backward; event IDs deduplicate credits.
    await db.ref('gs/watchBlock').transaction(old=>Math.max(old||0,end));
  }finally{p.destroy();}
}
module.exports={receipt,scan};
