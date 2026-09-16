const {test}=require('node:test');const assert=require('node:assert/strict');
const {execute,balance,units}=require('../functions/core');
let seq=0;const house={id:'1',rl:true},alice={id:'2',rl:false},bob={id:'3',rl:false};
function fixture(){return {runs:{r:{settlement:{},attendance:{a:{character:'Alice',discordId:'2'},b:{character:'Bob',discordId:'3'}}}}};}
function act(s,a,op,data={},id){return execute(s,a,op,data,id||'request_'+(++seq),1700000000000).root;}
function start(){let s=act(fixture(),house,'configure',{address:'0x'+'1'.repeat(40)});return act(s,house,'mode',{runId:'r',mode:'coin',rate:10,lines:{lead:15,treasury:5,risk:5,handling:0}});}
function deposit(s,a,amount){const id='deposit_'+(++seq);s=act(s,a,'depositRequest',{runId:'r',amount},id);return act(s,house,'receive',{id,event:{verified:true,id:'event_'+seq,chainId:1,to:s.gs.config.address,amount:s.gs.deposits[id].amount}});}
function invariant(s){const total=Object.values(s.accounts||{}).reduce((n,a)=>n+balance(a),0)+Object.values(s.gs.withdrawals||{}).filter(w=>w.status==='pending').reduce((n,w)=>n+units(w.amount),0);assert.equal(total,units(s.accounts['1'].usdReserved||0));for(const a of Object.values(s.accounts||{})){assert.equal(balance(a),units(a.gsBalance));assert.equal(balance(a),Object.values(a.tickets||{}).reduce((n,t)=>n+units(t.remainingUsd),0));}}

test('leader and other raider cannot debit Alice; owner pays once and refund restores balance',()=>{
 let s=deposit(start(),alice,100);s.runs.r.auctions={i:{status:'sold',currentBid:26,bids:{b:{amount:26,discordId:'2',ts:1}}}};
 const d={runId:'r',auctionId:'i',expectedAmount:26},before=JSON.stringify(s);
 for(const actor of [house,bob])assert.throws(()=>act(s,actor,'payWin',d),/winning raider/);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>act(s,alice,'payWin',{...d,expectedAmount:25}),/Price changed/);
 s=act(s,alice,'payWin',d,'self_payment');assert.equal(s.accounts['2'].gsBalance,74);
 assert.deepEqual(act(s,alice,'payWin',d,'self_payment'),s);
 assert.throws(()=>act(s,alice,'payWin',d,'second_payment'),/already paid/);
 assert.equal(s.accounts['_run_r'].gsBalance,26);invariant(s);
 s=act(s,house,'refundWin',{runId:'r',auctionId:'i'});assert.equal(s.accounts['2'].gsBalance,100);invariant(s);
});
