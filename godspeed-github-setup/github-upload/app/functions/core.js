'use strict';
// Monetary inputs and balances use USDC micro-units internally (six decimals).
const SCALE=1e6;
function units(n){const v=Number(n);if(!Number.isFinite(v)||Math.abs(v)>1e8||Math.abs(v*SCALE-Math.round(v*SCALE))>.01)throw Error('Invalid amount');return Math.round(v*SCALE);}
const dollars=n=>n/SCALE;
function positive(n){const u=units(n);if(u<=0)throw Error('Amount must be positive');return u;}
function need(ok,message){if(!ok)throw Error(message);}
function account(root,id){root.accounts??={};const a=root.accounts[id]??={};a.ledger??={};a.tickets??={};a.gsBalance??=0;return a;}
function balance(a){return Object.values(a.ledger||{}).filter(e=>e.unit==='GS').reduce((sum,e)=>sum+units(e.gsDelta||0),0);}
function entry(root,id,key,type,delta,meta,now){const a=account(root,id);need(!a.ledger[key],'Ledger entry already exists');a.ledger[key]={unit:'GS',type,gsDelta:dollars(delta),createdAt:now,...meta};a.gsBalance=dollars(balance(a));need(a.gsBalance>=0,'Insufficient GS');}
function take(root,id,amount){const a=account(root,id);need(balance(a)>=amount,'Insufficient GS');let left=amount;const pieces=[];for(const t of Object.values(a.tickets).sort((x,y)=>x.createdAt-y.createdAt||x.id.localeCompare(y.id))){const n=Math.min(left,units(t.remainingUsd));if(n>0){pieces.push({...t,usd:dollars(n),gs:dollars(n),remainingUsd:dollars(n)});t.remainingUsd=dollars(units(t.remainingUsd)-n);left-=n;}if(!left)break;}need(!left,'Ticket and balance mismatch');return pieces;}
function give(root,id,key,pieces,now){const a=account(root,id);pieces.forEach((p,i)=>{const ticketId=key+'_'+i;a.tickets[ticketId]={...p,id:ticketId,source:'transfer',transferredAt:now,remainingUsd:p.usd};});}
function transfer(root,from,to,n,key,type,now,meta={}){need(from!==to,'Choose another account');const pieces=take(root,from,n);give(root,to,key,pieces,now);entry(root,from,key+'_out',type==='cut'?'cut':type==='bid'?'bid':'transfer_out',-n,{...meta,to},now);entry(root,to,key+'_in',type==='cut'?'cut':'transfer_in',n,{...meta,from},now);return pieces;}
function banned(root,id){return !!root.bans?.['discord_'+id];}
function config(root){need(root.gs?.config?.enabled,'GS service is not enabled');return root.gs.config;}
function runFor(root,id){const r=root.runs?.[id];need(r,'Run not found');need(['coin','mixed'].includes(r.settlement?.settlementMode),'Legacy run: GS is unavailable');return r;}
// The same function is embedded into the HTML for the displayed preview.
function calculateCuts(state,total){
  const round=n=>Math.floor((n+1e-9)*100)/100,lines=state.gsCutLines||{lead:15,treasury:5,risk:5,handling:0};
  const pct=Object.values(lines).reduce((s,n)=>s+Number(n||0),0);if(pct<0||pct>100)throw Error('Compensation exceeds 100%');
  const named=round(total*pct/100),cap=round(Math.min(total,2000)*.20+Math.max(0,total-2000)*.15),managementCut=state.gsTaper?Math.min(named,cap):named,distributable=round(total-managementCut);
  const rows=Object.entries(state.raiders||{}),mutators=state.mutators||{};let flatTotal=0,percentageTotal=0,baseParts=0;
  for(const [,r] of rows){baseParts+=(r.base===false?0:1)+Number(r.adjustPct||0)/100;flatTotal+=Number(r.adjustGold||0);for(const [id,on] of Object.entries(r.mutators||{})){if(on&&mutators[id]){flatTotal+=Number(mutators[id].flat||0);percentageTotal+=Number(mutators[id].percentage||0);}}}
  const leftToDistribute=distributable-flatTotal,base=baseParts>0?leftToDistribute*(1-percentageTotal/100)/baseParts:0,cuts={};let totalPayout=0;
  for(const [key,r] of rows){let cut=(r.base===false?0:base)+base*Number(r.adjustPct||0)/100+Number(r.adjustGold||0);for(const [id,on] of Object.entries(r.mutators||{})){if(on&&mutators[id])cut+=leftToDistribute*Number(mutators[id].percentage||0)/100+Number(mutators[id].flat||0);}cuts[key]=round(cut);totalPayout+=cuts[key];}
  return {totalPot:total,managementPct:total?managementCut/total*100:0,managementCut,distributable,flatTotal,percentageTotal,baseParts,base,leftToDistribute,cuts,totalPayout:round(totalPayout),balance:round(distributable-totalPayout),named,cap,lines};
}
function collected(run){return Object.values(run.settlement.gsPayments||{}).filter(p=>p.status==='paid').reduce((s,p)=>s+units(p.amount),0);}
function raiderId(run,key){const r=run.settlement.raiders?.[key];need(r,'Raider missing');const matches=Object.values(run.attendance||{}).filter(a=>String(a.character||'').toLowerCase()===String(r.name||'').toLowerCase());const ids=[...new Set(matches.map(a=>String(a.discordId||'')).filter(Boolean))];need(ids.length===1,'Raider must have one verified attendance Discord ID');return ids[0];}
function currencyPolicy(s){return s.acceptedCurrencies?validateCurrencies(s.acceptedCurrencies):{gc:true,gold:s.settlementMode==='mixed'&&!!s.goldEnabled,usd:false};}
function validateCurrencies(c){need(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===3&&['gc','gold','usd'].every(k=>typeof c[k]==='boolean'),'Invalid currency choices');need(c.gc||c.gold||c.usd,'Select at least one currency');return {gc:c.gc,gold:c.gold,usd:c.usd};}
function execute(input,actor,op,data,opId,now=Date.now()){
  const root=structuredClone(input||{});root.gs??={};root.gs.ops??={};
  need(/^[A-Za-z0-9_-]{8,100}$/.test(opId),'Invalid request ID');
  const prior=root.gs.ops[opId];if(prior){need(prior.actor===actor.id&&prior.op===op&&prior.payload===JSON.stringify(data),'Request ID reused');return {root,result:prior.result};}
  need(actor.id&&!banned(root,actor.id),'Account is banned or not authenticated');
  const rl=()=>need(actor.rl,'Raid leader required');
  let result={ok:true};const meta={runId:data.runId||'',actor:actor.id};
  if(op==='manualInitialize'){
    rl();need(!root.gs.config?.enabled||root.gs.config.accountingMode==='manual','Existing automated ledger requires migration review');
    root.gs.config={...(root.gs.config||{}),enabled:true,accountingMode:'manual',houseId:actor.id};
  }else if(op==='configure'){
    rl();const address=String(data.address||'').toLowerCase();need(/^0x[a-f0-9]{40}$/.test(address),'Enter an Ethereum address');
    root.gs.config={...(root.gs.config||{}),enabled:true,houseId:actor.id,address,chainId:1,usdcNetwork:'Ethereum',confirmations:Math.max(12,Number(data.confirmations)||12)};
  }else{
    const cfg=config(root),house=cfg.houseId,houseAccount=account(root,house);
    const memberGCAction=['manualWithdraw','withdraw','withdrawCancel','depositCancel','depositRequest','submitHash'].includes(op)||(op==='payWin'&&!data.gold&&(!data.method||data.method==='gs'))||(op==='payoutChoice'&&data.method==='gs');
    need(actor.rl||cfg.memberGCEnabled===true||!memberGCAction,'Member GC actions are temporarily unavailable');
    if(op==='manualCredit'){
      rl();need(cfg.accountingMode==='manual','Manual accounting is not enabled');
      need(/^\d{15,22}$/.test(String(data.owner))&&!banned(root,data.owner),'Enter a valid, unbanned Discord ID');
      need(data.received===true,'Confirm payment was received');
      const reference=String(data.reference||'').trim().toLowerCase(),reason=String(data.reason||'').trim();
      need(reference.length>=3&&reference.length<=120,'Enter a unique payment reference (3–120 characters)');need(reason.length>=3&&reason.length<=300,'Enter a reason (3–300 characters)');
      root.gs.manualReceipts??={};need(!Object.values(root.gs.manualReceipts).some(r=>r.reference===reference),'Payment reference already recorded');
      const run=runFor(root,data.runId);need(!run.archived,'Select the current run');const rate=Number(run.settlement.usdPer1000);need(Number.isFinite(rate)&&rate>0,'Set the run exchange rate first');
      const n=positive(data.amount),a=account(root,String(data.owner));
      a.tickets[opId]={id:opId,usd:dollars(n),gs:dollars(n),remainingUsd:dollars(n),rateUsdPer1000:rate,runId:data.runId,createdAt:now,expiresAt:0,source:'manual-credit'};
      entry(root,String(data.owner),opId,'manual_credit',n,{...meta,reference,reason,confirmedBy:actor.id},now);
      houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)+n);
      root.gs.manualReceipts[opId]={owner:String(data.owner),amount:dollars(n),reference,reason,confirmedBy:actor.id,createdAt:now,runId:data.runId};result={credited:dollars(n)};
    }else if(op==='manualWithdraw'){
      need(cfg.accountingMode==='manual','Manual accounting is not enabled');need(actor.id!==house,'Leader withdrawals are handled outside member requests');
      const details=String(data.details||'').trim();need(details.length>=3&&details.length<=300,'Enter payout instructions (3–300 characters)');
      const n=positive(data.amount),pieces=take(root,actor.id,n);entry(root,actor.id,opId,'withdraw',-n,{status:'reserved',reason:'Manual payout requested'},now);
      root.gs.withdrawals??={};root.gs.withdrawals[opId]={owner:actor.id,amount:dollars(n),details,status:'pending',createdAt:now,pieces,manual:true};result={id:opId};
    }else if(op==='manualWithdrawPaid'){
      rl();need(cfg.accountingMode==='manual'&&data.paid===true,'Confirm the external payout');
      const w=root.gs.withdrawals?.[data.id];need(w?.manual&&w.status==='pending','Withdrawal unavailable');
      const reference=String(data.reference||'').trim().toLowerCase();need(reference.length>=3&&reference.length<=120,'Enter a unique payout reference');
      need(!Object.values(root.gs.withdrawals||{}).some(x=>x.reference===reference),'Payout reference already recorded');
      const reserve=units(houseAccount.usdReserved||0)-positive(w.amount);need(reserve>=0,'Ledger liability mismatch');houseAccount.usdReserved=dollars(reserve);
      Object.assign(w,{status:'paid',paidAt:now,paidBy:actor.id,reference});entry(root,w.owner,opId,'manual_payout',0,{amount:w.amount,reference,confirmedBy:actor.id},now);
    }else if(op==='currencies'){
      rl();const run=runFor(root,data.runId),s=run.settlement;need(!run.archived&&!s.payoutStarted,'Currency changes are closed for this run');
      const next=validateCurrencies(data.currencies),previous=currencyPolicy(s);
      // Preserve the terms offered on existing bids before changing future bids.
      for(const a of Object.values(run.auctions||{}))for(const b of Object.values(a.bids||{}))if(!b.acceptedCurrencies){b.acceptedCurrencies={...previous};b.rateUsdPer1000=s.usdPer1000;}
      s.acceptedCurrencies=next;s.currenciesUpdatedAt=now;s.currenciesUpdatedBy=actor.id;
      if(next.gold){s.goldEnabled=true;s.settlementMode='mixed';}
      result={currencies:next};
    }else if(op==='runSettings'){
      rl();const run=runFor(root,data.runId),s=run.settlement;need(!run.archived&&!s.payoutStarted,'Settings are locked after payouts start');
      const cut=Number(data.adminCut),rate=Number(data.rate);need(Number.isFinite(cut)&&cut>=0&&cut<=100,'Admin cut must be from 0 to 100');need(Number.isFinite(rate)&&rate>0,'Rate must be positive');
      if(rate!==Number(s.usdPer1000||s.usdcPer1000||10))need(!Object.values(run.auctions||{}).some(a=>a.status==='sold'||Object.keys(a.bids||{}).length),'Exchange rate is locked after bids or sales');
      const previous={adminCut:Object.values(s.gsCutLines||{lead:15,treasury:5,risk:5,handling:0}).reduce((n,v)=>n+Number(v||0),0),rate:s.usdPer1000};
      Object.assign(s,{managementCut:cut,gsCutLines:{lead:cut,treasury:0,risk:0,handling:0},gsTaper:false,usdPer1000:rate,usdcPer1000:rate,settingsUpdatedAt:now,settingsUpdatedBy:actor.id});
      result={adminCut:cut,rate,previous};
    }else if(op==='mode'){
      rl();const run=root.runs?.[data.runId];need(run,'Run not found');need(!run.archived&&!Object.keys(run.auctions||{}).length&&!run.settlement?.payoutStarted,'Set mode on an empty current run');
      const mode=data.mode||'coin';need(['coin','mixed'].includes(mode),'Invalid mode');const rate=Number(data.rate);need(Number.isFinite(rate)&&rate>0,'Rate must be positive');
      const lines=data.lines||{lead:15,treasury:5,risk:5,handling:0};need(['lead','treasury','risk','handling'].every(k=>Number.isFinite(Number(lines[k]))&&Number(lines[k])>=0),'Invalid cut lines');need(Object.keys(lines).length===4,'Unknown cut line');need(!Number(lines.handling)||data.goldEnabled,'Handling requires gold handling');
      need(Number(lines.risk)===0||Number(lines.risk)>=5&&Number(lines.risk)<=10,'Risk must be off or between 5 and 10 percent');need([0,5].includes(Number(lines.handling)),'Handling must be off or 5 percent');const haircut=Number(data.haircut||0);need([0,5,10].includes(haircut),'Haircut must be 0, 5 or 10');const s=run.settlement??={};Object.assign(s,{settlementMode:mode,gsCutLines:lines,gsTaper:!!data.taper,gsHaircutPct:haircut,gsWindowHours:48,goldEnabled:mode==='mixed'&&!!data.goldEnabled,usdPer1000:rate,usdcPer1000:rate,rateLocked:true,rateLockedAt:now,rateLockedBy:actor.id});if(s.acceptedCurrencies)s.acceptedCurrencies=validateCurrencies({...s.acceptedCurrencies,gold:s.goldEnabled});calculateCuts(s,0);
    }else if(op==='depositRequest'){
      const run=runFor(root,data.runId);need(!run.archived,'Choose the current run for a deposit');const n=positive(data.amount);need(n>=1e6,'Minimum deposit is 1 USDC');
      root.gs.deposits??={};const mine=Object.values(root.gs.deposits).filter(d=>d.owner===actor.id&&d.status==='pending');need(mine.length<5,'Finish an existing deposit first');
      // Tag is six-decimal exact amount, unique among all pending requests.
      let tagged=n;const amounts=new Set(Object.values(root.gs.deposits).filter(d=>d.status==='pending').map(d=>units(d.amount)));while(amounts.has(tagged))tagged++;
      const tag=opId.slice(-8).toUpperCase();root.gs.deposits[opId]={owner:actor.id,runId:data.runId,requestedAmount:dollars(n),amount:dollars(tagged),tag,status:'pending',createdAt:now,expiresAt:now+86400000,rateUsdPer1000:run.settlement.usdPer1000,address:cfg.address,chainId:1};result={id:opId,...root.gs.deposits[opId]};
    }else if(op==='depositCancel'){
      const d=root.gs.deposits?.[data.id];need(d&&d.status==='pending'&&(actor.rl||d.owner===actor.id),'Deposit unavailable');d.status='cancelled';d.cancelledAt=now;
    }else if(op==='submitHash'){
      const d=root.gs.deposits?.[data.id];need(d&&d.owner===actor.id&&d.status==='pending','Deposit not found');need(/^0x[a-fA-F0-9]{64}$/.test(data.hash),'Invalid transaction hash');d.hash=data.hash.toLowerCase();result={ok:true};
    }else if(op==='receive'){
      rl();const d=root.gs.deposits?.[data.id],ev=data.event;need(d&&d.status==='pending','Deposit already handled or missing');need(!banned(root,d.owner),'Recipient banned');need(ev&&ev.verified===true,'Verified receipt required');need(ev.chainId===1&&ev.to===d.address&&units(ev.amount)===units(d.amount),'Receipt does not match request');
      root.gs.chainEvents??={};need(!root.gs.chainEvents[ev.id],'Transfer already credited');
      const n=positive(d.amount),available=d.owner===house||data.forceMint?0:Math.min(n,balance(houseAccount)),mint=n-available;
      if(available)transfer(root,house,d.owner,available,opId+'_float','transfer',now,{...meta,runId:d.runId,depositId:data.id});
      if(mint){const a=account(root,d.owner);a.tickets[opId]={id:opId,usd:dollars(mint),gs:dollars(mint),remainingUsd:dollars(mint),rateUsdPer1000:d.rateUsdPer1000,runId:d.runId,createdAt:now,expiresAt:root.runs?.[d.runId]?.settlement?.claimDeadline||0,source:'mint'};entry(root,d.owner,opId+'_mint','mint',mint,{...meta,runId:d.runId,depositId:data.id},now);houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)+mint);}
      entry(root,d.owner,opId+'_deposit','deposit',0,{usd:d.amount,eventId:ev.id,depositId:data.id},now);root.gs.chainEvents[ev.id]={depositId:data.id,creditedAt:now};if(root.gs.unmatched)delete root.gs.unmatched[ev.id];Object.assign(d,{status:'credited',receivedAt:now,eventId:ev.id,floatGs:dollars(available),mintGs:dollars(mint)});result={float:dollars(available),mint:dollars(mint)};
    }else if(op==='assignDeposit'){
      rl();const ev=data.event,run=runFor(root,data.runId);need(ev?.verified&&ev.to===cfg.address,'Deposit recipient mismatch');need(/^\d+$/.test(data.owner)&&!banned(root,data.owner),'Invalid recipient');root.gs.deposits??={};const id=opId+'_assigned';root.gs.deposits[id]={owner:data.owner,runId:data.runId,amount:ev.amount,status:'pending',createdAt:ev.blockTime,rateUsdPer1000:run.settlement.usdPer1000,address:cfg.address,chainId:1};
      const out=execute(root,actor,'receive',{id,event:ev,forceMint:!!data.forceMint},opId+'_credit',now);Object.assign(root,out.root);result=out.result;
    }else if(op==='placeBid'){
      const run=runFor(root,data.runId),a=run.auctions?.[data.auctionId];need(!run.archived&&a?.status==='open'&&!a.paused&&a.endsAt>now,'Auction is not live');
      const attendance=Object.values(run.attendance||{}).find(a=>a.approved&&String(a.discordId)===actor.id);need(attendance?.character,'Check in before bidding');
      const n=positive(data.amount),bids=Object.values(a.bids||{}).filter(b=>!b.retracted),minimum=units(a.currentBid)+(bids.length?units(a.minIncrement||1):0);need(n>=minimum,'Bid is below minimum');
      a.bids??={};a.bids[opId]={amount:dollars(n),discordId:actor.id,bidder:attendance.character,ts:now,acceptedCurrencies:currencyPolicy(run.settlement),rateUsdPer1000:run.settlement.usdPer1000};a.currentBid=dollars(n);if(a.endsAt-now<30000){a.endsAt=now+30000;a.remaining=30;}
    }else if(op==='payWin'){
      const run=runFor(root,data.runId),s=run.settlement,a=run.auctions?.[data.auctionId];need(a?.status==='sold','Item is not sold');need(!s.payoutStarted,'Collections locked after payouts start');
      const bids=Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>b.amount-a.amount||a.ts-b.ts);const win=bids[0];need(win&&win.discordId,'Winner has no Discord identity');const method=data.method||(data.gold===true?'gold':'gs');need(['gs','gold','usd'].includes(method),'Invalid payment currency');need(method==='gs'?actor.id===String(win.discordId):actor.rl,'Only the winning raider can pay GC; only the leader can record an external receipt');const allowed=win.acceptedCurrencies?validateCurrencies(win.acceptedCurrencies):currencyPolicy(s);need(allowed[method==='gs'?'gc':method],'This currency was not accepted for the winning bid');if(method==='usd')need(data.externalReceived===true,'Confirm the USD/USDC receipt');need(data.expectedAmount===undefined||Number(data.expectedAmount)===Number(a.currentBid),'Price changed; review the purchase again');need(!banned(root,String(win.discordId)),'Winner banned');need(Number(win.amount)===Number(a.currentBid),'Winner price mismatch');
      s.gsPayments??={};need(!s.gsPayments[data.auctionId]||s.gsPayments[data.auctionId].status==='refunded','Item already paid');
      const total=positive(win.amount),gold=method==='gold',external=method!=='gs',rate=Number(win.rateUsdPer1000||s.usdPer1000);need(Number.isFinite(rate)&&rate>0,'Invalid saved exchange rate');
      if(external&&cfg.accountingMode==='manual'){
        need(data.externalReceived===true,'Confirm the external receipt');
        const pot=account(root,'_run_'+data.runId);pot.tickets[opId]={id:opId,usd:dollars(total),gs:dollars(total),remainingUsd:dollars(total),rateUsdPer1000:rate,runId:data.runId,createdAt:now,expiresAt:0,source:'manual-auction-receipt'};
        entry(root,'_run_'+data.runId,opId,'manual_collection',total,{...meta,auctionId:data.auctionId,method,confirmedBy:actor.id},now);houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)+total);
      }else transfer(root,external?house:String(win.discordId),'_run_'+data.runId,total,opId,'bid',now,{...meta,auctionId:data.auctionId,method,reason:external?'Funded house GC backing leader-confirmed '+method+' receipt':'Won item'});
      s.gsPayments[data.auctionId]={status:'paid',owner:String(win.discordId),amount:dollars(total),method,goldAmount:gold?dollars(total)*1000/rate:0,rateUsdPer1000:rate,externalAmount:method==='usd'?dollars(total):0,receiptConfirmedBy:external?actor.id:null,paidAt:now,operation:opId};a.paid=true;result={amount:dollars(total)};
    }else if(op==='refundWin'){
      rl();const run=runFor(root,data.runId),s=run.settlement,p=s.gsPayments?.[data.auctionId];need(p?.status==='paid','No payment to reverse');need(!s.payoutStarted,'Reopen/correct settlement before reversing a locked purchase');
      if(p.method==='gold')need(data.goldReturned===true,'Confirm gold returned');if(p.method==='usd')need(data.externalReturned===true,'Confirm USD/USDC returned');if(['gold','usd'].includes(p.method)&&cfg.accountingMode==='manual'){const n=positive(p.amount);take(root,'_run_'+data.runId,n);entry(root,'_run_'+data.runId,opId,'manual_refund',-n,{...meta,auctionId:data.auctionId,confirmedBy:actor.id},now);houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)-n);}else transfer(root,'_run_'+data.runId,['gold','usd'].includes(p.method)?house:p.owner,positive(p.amount),opId,'transfer',now,{...meta,reason:'Won-item refund',auctionId:data.auctionId});p.status='refunded';p.refundedAt=now;run.auctions[data.auctionId].paid=false;
    }else if(op==='lockCuts'){
      rl();const run=runFor(root,data.runId),s=run.settlement;need(!s.payoutStarted,'Cuts already locked');need(Object.keys(s.raiders||{}).length,'Add raiders first');
      for(const [id,a] of Object.entries(run.auctions||{}))if(a.status==='sold')need(s.gsPayments?.[id]?.status==='paid','Collect every sold item first');
      if(data.payoutMethods!==undefined){s.payoutMethods=validateCurrencies(data.payoutMethods);need(!s.payoutMethods.usd||cfg.accountingMode==='manual','Manual USD payouts are unavailable');for(const r of Object.values(s.raiders||{}))delete r.gsPayoutMethod;}
      const calc=calculateCuts(s,dollars(collected(run)));need(calc.totalPot>0,'Pot is empty');need(calc.balance>=0&&Object.values(calc.cuts).every(v=>v>=0),'Mutators exceed available pot');
      for(const [key,r] of Object.entries(s.raiders)){r.gsOwner=raiderId(run,key);r.lockedCut=calc.cuts[key];r.gsCut=calc.cuts[key];r.lockedBreakdown=[{label:'Base cut',amount:calc.base},...Object.entries(r.mutators||{}).filter(([id,on])=>on&&s.mutators?.[id]).map(([id])=>({label:s.mutators[id].name,amount:(calc.leftToDistribute*Number(s.mutators[id].percentage||0)/100)+Number(s.mutators[id].flat||0)}))];}
      Object.assign(s,{payoutUsdPer1000:Number(s.payoutUsdPer1000||s.usdPer1000||s.usdcPer1000||10),payoutStarted:true,setupUnlocked:false,payoutStartedAt:now,claimDeadline:now+172800000,gsLocked:calc,rateLocked:true,lockedDistributable:calc.distributable,cutSnapshotVersion:3});
      // End of run starts withdrawal windows for tickets stamped to this run.
      for(const a of Object.values(root.accounts||{}))for(const t of Object.values(a.tickets||{}))if(t.runId===data.runId&&!t.expiresAt)t.expiresAt=now+172800000;
      if(calc.managementCut)transfer(root,'_run_'+data.runId,house,positive(calc.managementCut),opId+'_management','cut',now,{...meta,lines:s.gsCutLines||{lead:15,treasury:5,risk:5,handling:0}});
      result=calc;
    }else if(op==='payoutRate'){
      rl();const s=runFor(root,data.runId).settlement,rate=Number(data.rate);
      need(Number.isFinite(rate)&&rate>0&&rate<=1000000,'Enter a positive payout rate up to 1000000');
      const previous=s.payoutUsdPer1000??null;
      need(data.expectedRate===previous,'Payout rate changed; reload before saving');
      s.payoutUsdPer1000=rate;s.payoutRateHistory??={};
      s.payoutRateHistory[opId]={previous,rate,createdAt:now,createdBy:actor.id};
      result={rate,previous};
    }else if(op==='submitClaim'){
      const run=runFor(root,data.runId),s=run.settlement,r=s.raiders?.[data.raiderKey];
      need(s.payoutStarted&&r&&String(r.gsOwner)===actor.id,'Submit your own locked payout claim');
      need(!r.paid&&units(r.gsCut)>units(r.gsCredited||0),'Payout already completed');
      const prior=r.submission||{},deadline=Math.max(Number(s.claimDeadline||s.payoutStartedAt+172800000),Number(r.claimExtensionUntil||0));
      need(prior.submittedAt||now<=deadline,'Claim window expired; ask the leader to reopen it');
      const method=data.method,allowed=s.payoutMethods||{gc:true,gold:s.settlementMode==='mixed'&&!!s.goldEnabled,usd:false};
      need(['gold','usd','gs'].includes(method)&&allowed[method==='gs'?'gc':method]===true,'This payout method is disabled');
      need(r.gsPayoutMethod===method,'Payout choice changed; reload before submitting');
      need(method!=='gs'||cfg.memberGCEnabled===true,'GC actions are temporarily unavailable');
      const claim={method:method==='usd'?'usdc':method,status:'submitted',submittedAt:prior.submittedAt||now,updatedAt:now,discordId:actor.id,character:r.name,claimAmount:dollars(units(r.gsCut)-units(r.gsCredited||0)),correctionNote:''};
      if(method==='gold'){
        const seller=String(data.seller||'').trim(),item=String(data.item||'').trim(),image=String(data.imageData||'');
        need(seller.length>0&&seller.length<=24&&item.length>0&&item.length<=60,'Enter the seller and listed item');
        need(image.length<=1250000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image),'Attach a prepared JPG, PNG or WebP screenshot');
        const identity=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
        need(!Object.values(run.auctions||{}).some(a=>a.status==='sold'&&identity(a.name)===identity(item)&&Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>b.amount-a.amount||a.ts-b.ts)[0]?.discordId===actor.id),'Use a separate item from your raid purchases');
        Object.assign(claim,{seller,item,imageData:image,imageName:String(data.imageName||'auction-screenshot.jpg').slice(0,80),imageBytes:Math.ceil(image.length*.75)});
      }else if(method==='usd'){
        const wallet=String(data.walletAddress||'').trim();need(/^0x[a-fA-F0-9]{40}$/.test(wallet),'Enter an Ethereum wallet address');
        Object.assign(claim,{walletAddress:wallet,network:'Ethereum'});
      }
      r.submission=claim;result={submittedAt:claim.submittedAt,updatedAt:now};
    }else if(op==='claimAdmin'){
      rl();const s=runFor(root,data.runId).settlement,r=s.raiders?.[data.raiderKey];
      need(s.payoutStarted&&r&&!r.paid,'Select an unpaid locked payout');
      if(data.action==='reopen')r.claimExtensionUntil=now+86400000;
      else if(data.action==='correction'){
        const note=String(data.note||'').trim();need(note&&note.length<=240&&r.submission?.submittedAt,'Enter a correction note for a submitted claim');
        Object.assign(r.submission,{status:'correction',correctionNote:note,correctionRequestedAt:now,correctionRequestedBy:actor.id});
      }else throw Error('Invalid claim action');
    }else if(op==='payoutChoice'){
      const run=runFor(root,data.runId),r=run.settlement.raiders?.[data.raiderKey];need(r&&raiderId(run,data.raiderKey)===actor.id,'Select your own cut');need(run.settlement.payoutStarted,'Payouts have not started');need(!r.paid,'Payout already completed');need(['gs','gold','usd'].includes(data.method),'Invalid method');const allowed=run.settlement.payoutMethods||{gc:true,gold:run.settlement.settlementMode==='mixed'&&!!run.settlement.goldEnabled,usd:false};need(allowed[data.method==='gs'?'gc':data.method]===true,'This payout method is disabled');if(r.gsPayoutMethod!==data.method&&r.submission?.submittedAt)r.submission.status='draft';r.gsPayoutMethod=data.method;
    }else if(op==='creditCut'){
      rl();const run=runFor(root,data.runId),s=run.settlement,r=s.raiders?.[data.raiderKey];need(s.payoutStarted&&r?.gsOwner,'Cut is not locked');need(!banned(root,r.gsOwner),'Recipient banned');const n=units(r.gsCut)-units(r.gsCredited||0);need(n>0,'No outstanding GS cut');
      const method=r.gsPayoutMethod||(s.payoutMethods?null:'gs'),allowed=s.payoutMethods||{gc:true,gold:s.settlementMode==='mixed'&&!!s.goldEnabled,usd:false};need(method&&allowed[method==='gs'?'gc':method]===true,'Recipient must select an enabled payout method');need(!s.payoutMethods||data.expectedMethod===method,'Payout method changed; review before paying');need(data.expectedAmount===undefined||units(data.expectedAmount)===n,'Payout amount changed; review before paying');
      const gold=method==='gold';let goldAmount=0;
      if(gold){need(data.goldDelivered===true,'Confirm delivery of the gold payout');const pieces=take(root,'_run_'+data.runId,n);goldAmount=s.payoutUsdPer1000?n/1e6*1000/s.payoutUsdPer1000:pieces.reduce((sum,p)=>sum+p.usd*1000/p.rateUsdPer1000,0);need(data.expectedPayoutRate===undefined||data.expectedPayoutRate===(s.payoutUsdPer1000??null),'Payout rate changed; review before paying');need(Number.isFinite(data.expectedGold)&&Math.abs(goldAmount-data.expectedGold)<.000001,'Gold quote changed; review before paying');entry(root,'_run_'+data.runId,opId,'cut',-n,{...meta,method:'gold',owner:r.gsOwner,goldAmount},now);houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)-n);}
      else if(method==='usd'){need(cfg.accountingMode==='manual'&&data.externalPaid===true,'Confirm the external USD/USDC payout');need(data.expectedAmount!==undefined,'Confirm the payout amount');take(root,'_run_'+data.runId,n);entry(root,'_run_'+data.runId,opId,'cut',-n,{...meta,method:'usd',owner:r.gsOwner,externalPaid:true},now);const reserve=units(houseAccount.usdReserved||0)-n;need(reserve>=0,'Reserve mismatch');houseAccount.usdReserved=dollars(reserve);}
      else transfer(root,'_run_'+data.runId,r.gsOwner,n,opId,'cut',now,meta);
      r.gsCredited=r.gsCut;r.paid=true;r.paidAmount=r.gsCut;r.paidAt=now;r.submission={...(r.submission||{}),method,status:'paid',discordId:r.gsOwner};r.payoutEvents??={};r.payoutEvents[opId]={type:'paid',method,amount:dollars(n),goldAmount,rateUsdPer1000:gold?(s.payoutUsdPer1000||((dollars(n)*1000)/goldAmount)):0,createdAt:now,createdBy:actor.id};
    }else if(op==='adjustCut'){
      rl();const run=runFor(root,data.runId),s=run.settlement,r=s.raiders?.[data.raiderKey];need(s.payoutStarted&&r?.gsOwner,'Cut not locked');const delta=units(data.amount);need(delta&&String(data.reason||'').trim(),'Enter adjustment and reason');need(units(r.gsCut)+delta>=units(r.gsCredited||0),'Already credited GS requires a separate voluntary return');
      if(delta>0)transfer(root,house,'_run_'+data.runId,delta,opId+'_fund','transfer',now,{...meta,reason:data.reason});else transfer(root,'_run_'+data.runId,house,-delta,opId+'_return','transfer',now,{...meta,reason:data.reason});
      r.gsCut=dollars(units(r.gsCut)+delta);r.paid=false;s.gsAdjustments??={};s.gsAdjustments[opId]={raiderKey:data.raiderKey,amount:dollars(delta),reason:String(data.reason).slice(0,200),createdAt:now};s.gsDeficit=dollars(units(s.gsDeficit||0)+delta);
    }else if(op==='closePot'){
      rl();const run=runFor(root,data.runId);need(run.settlement.payoutStarted,'Cuts are not locked');need(Object.values(run.settlement.raiders||{}).every(r=>units(r.gsCredited||0)>=units(r.gsCut||0)),'Finish all cut credits first');const remainder=balance(account(root,'_run_'+data.runId));need(remainder>0,'No remaining GS');transfer(root,'_run_'+data.runId,house,remainder,opId,'transfer',now,{...meta,reason:'Settlement rounding remainder'});run.settlement.gsRemainderReturned=dollars(remainder);
    }else if(op==='withdraw'){
      const n=positive(data.amount);need(/^0x[a-fA-F0-9]{40}$/.test(data.address),'Enter an Ethereum wallet');need(actor.id!==house,'House exits by selling float to depositors');const pieces=take(root,actor.id,n);entry(root,actor.id,opId,'withdraw',-n,{status:'reserved',address:data.address},now);
      root.gs.withdrawals??={};root.gs.withdrawals[opId]={owner:actor.id,amount:dollars(n),address:data.address.toLowerCase(),status:'pending',createdAt:now,pieces};result={id:opId};
    }else if(op==='withdrawCancel'){
      const w=root.gs.withdrawals?.[data.id];need(w&&w.status==='pending'&&(actor.rl||w.owner===actor.id),'Withdrawal unavailable');give(root,w.owner,opId,w.pieces,now);entry(root,w.owner,opId,'withdraw',positive(w.amount),{reason:'Withdrawal cancelled'},now);w.status='cancelled';
    }else if(op==='withdrawPaid'){
      rl();const w=root.gs.withdrawals?.[data.id],ev=data.event;need(w&&w.status==='pending','Withdrawal already handled');need(!banned(root,w.owner),'Recipient banned');need(ev?.verified&&ev.to===w.address&&ev.from===cfg.address&&units(ev.amount)===units(w.amount),'Payout receipt mismatch');root.gs.withdrawEvents??={};need(!root.gs.withdrawEvents[ev.id],'Payout receipt already used');
      const reserve=units(houseAccount.usdReserved||0)-units(w.amount);need(reserve>=0,'Reserve mismatch');houseAccount.usdReserved=dollars(reserve);root.gs.withdrawEvents[ev.id]=data.id;w.status='paid';w.paidAt=now;w.eventId=ev.id;entry(root,w.owner,opId,'withdraw',0,{usd:-w.amount,status:'paid',eventId:ev.id},now);
    }else if(op==='floatTransfer'){
      rl();need(/^\d+$/.test(data.to)&&!banned(root,data.to),'Invalid or banned recipient');transfer(root,house,data.to,positive(data.amount),opId,'transfer',now,{reason:String(data.reason||'House float transfer')});
    }else if(op==='haircut'){
      rl();const a=account(root,data.owner);need(!banned(root,data.owner),'Recipient banned');let fee=0;
      for(const t of Object.values(a.tickets)){const s=root.runs?.[t.runId]?.settlement,pct=Number(s?.gsHaircutPct||0);if(!t.haircutAt&&t.expiresAt&&t.expiresAt<now&&[5,10].includes(pct)){const n=Math.floor(units(t.remainingUsd)*pct/100);t.remainingUsd=dollars(units(t.remainingUsd)-n);fee+=n;t.haircutAt=now;}}
      need(fee>0,'No eligible expired tickets');entry(root,data.owner,opId,'haircut',-fee,{reason:'Published withdrawal-window haircut'},now);houseAccount.usdReserved=dollars(units(houseAccount.usdReserved||0)-fee);
    }else throw Error('Unknown GS operation');
  }
  root.gs.ops[opId]={actor:actor.id,op,payload:JSON.stringify(data),createdAt:now,result};root.gs.audit??={};root.gs.audit[opId]={actor:actor.id,op,runId:data.runId||'',createdAt:now};
  root.audit??={};root.audit[data.runId||'gs']??={};root.audit[data.runId||'gs'][opId]={type:'gs_'+op,actor:actor.id,ts:now,amount:data.amount||0,reason:data.reason||'',operationId:opId};
  return {root,result};
}
module.exports={execute,units,dollars,balance,calculateCuts,collected};




