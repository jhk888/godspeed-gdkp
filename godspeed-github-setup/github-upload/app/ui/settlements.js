// Cross-run controls must never borrow the currently displayed run's accounting state.
function dashboardCompare(a,b,sort){
 let order=0;
 if(sort==='claim-oldest'||sort==='claim-newest'){
  const at=Number(a.submittedAt)||0,bt=Number(b.submittedAt)||0;
  if(!at!==!bt)return at?-1:1;
  order=sort==='claim-oldest'?at-bt:bt-at;
 }else order=sort==='newest'?b.date-a.date:sort==='name'?a.name.localeCompare(b.name):sort==='amount'?Number(b.sortAmount||0)-Number(a.sortAmount||0):a.date-b.date;
 return order||a.name.localeCompare(b.name)||a.key.localeCompare(b.key)||a.raiderKey.localeCompare(b.raiderKey);
}
function dashboardTotals(entries,runs){
 const total={gold:0,usdc:0,gc:0,unselected:0,unavailable:0,estimatedGold:false};
 for(const e of entries){
  if(e.category==='paid'||e.saving)continue;
  const s=runs[e.key]?.settlement,r=s?.raiders?.[e.raiderKey];if(!r){total.unavailable++;continue;}
  const coin=['coin','mixed'].includes(s.settlementMode),method=coin?r.gsPayoutMethod||r.submission?.method:r.submission?.method;
  let due,rate;
  if(coin){due=Math.max(0,Number(r.gsCut||0)-Number(r.gsCredited||0));rate=Number(s.payoutUsdPer1000||s.usdPer1000||s.usdcPer1000||10);}
  else{
   if(r.lockedCut==null||!Number.isFinite(Number(r.lockedCut))){total.unavailable++;continue;}
   const cut=dashboardLegacyCut(r);due=Math.max(0,cut-Number(r.paidAmount??(r.paid?cut:0)));rate=Math.max(.01,Number(s.usdPer1000||s.usdcPer1000)||10);
  }
  if(!Number.isFinite(due)||!Number.isFinite(rate)||rate<=0){total.unavailable++;continue;}
  if(due<=0)continue;
  if(method==='gold'){total.gold+=Math.round((coin?due*1000/rate:due)*100);if(coin&&!s.payoutUsdPer1000)total.estimatedGold=true;}
  else if(method==='usd'||method==='usdc')total.usdc+=Math.round((coin?due:due*rate/1000)*100);
  else if(method==='gs')total.gc+=Math.round(due*1000000);
  else total.unselected++;
 }
 total.gold/=100;total.usdc/=100;total.gc/=1000000;return total;
}
function dashboardTotalsHTML(shown,all,runs){
 const card=(label,t)=>`<div class="dashboard-total"><div class="settlement-muted">${label}</div><strong>Gold due: ${t.gold.toLocaleString(undefined,{maximumFractionDigits:2})}g${t.estimatedGold?' (estimate)':''}</strong><div>USDC due: ${t.usdc.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} · GC due: ${t.gc.toLocaleString(undefined,{maximumFractionDigits:6})}</div>${t.unselected?`<div class="settlement-muted">${t.unselected} awaiting payout method, excluded from totals</div>`:''}${t.unavailable?`<div class="settlement-muted">${t.unavailable} amounts unavailable, excluded from totals</div>`:''}${t.estimatedGold?'<div class="settlement-muted">Some gold payouts require a rate quote before payment.</div>':''}</div>`;
 return card('Due in this view',dashboardTotals(shown,runs))+card('Due across all runs',dashboardTotals(all,runs));
}
const dashboardPayments=new Map();
function dashboardPaymentKey(entry){return JSON.stringify([accountDiscordId(),entry.key,entry.raiderKey]);}
function dashboardPaymentPending(entry){
 const key=dashboardPaymentKey(entry),pending=dashboardPayments.get(key);
 if(!pending)return false;
 const r=settlementsDashboardRuns[entry.key]?.settlement?.raiders?.[entry.raiderKey];
 const complete=r?.paid&&(r.gsCut!=null?Number(r.gsCredited||0)>=Number(r.gsCut):Number(r.paidAmount||0)>=dashboardLegacyCut(r));
 if(pending.saved&&complete){dashboardPayments.delete(key);return false;}
 return true;
}
function dashboardLegacyCut(r){
 if(r.lockedCut==null||!Number.isFinite(Number(r.lockedCut)))throw Error('This payout does not have a locked cut. Open the run to review it.');
 return Math.max(0,Math.floor(Number(r.lockedCut)+Object.values(r.cutAdjustments||{}).filter(a=>a&&!a.reversedAt).reduce((n,a)=>n+(Number(a.amount)||0),0)));
}
function dashboardLegacyPayment(run,key,expected,eventId,actor,now,reopen=false){
 if(!run)return run; // Firebase may call once before its local cache is populated.
 const s=run.settlement,r=s?.raiders?.[key];
 if(run.deleted||run.deletedAt||!s?.payoutStarted||!r||['coin','mixed'].includes(s.settlementMode))throw Error('Payout is no longer available.');
 const cut=dashboardLegacyCut(r),method=r.submission?.method||'manual',rate=Math.max(.01,Number(s.usdPer1000||s.usdcPer1000)||10);
 if(cut!==expected.cut||method!==expected.method||rate!==expected.rate)throw Error('The payout changed. Review the updated row before trying again.');
 if(reopen?!r.paid:!!r.paid&&Number(r.paidAmount??cut)>=cut)return run;
 r.payoutEvents??={};
 r.payoutEvents[eventId]=reopen?{type:'reopened',amount:cut,priorPaidAt:r.paidAt||null,priorPaidBy:r.paidBy||null,priorMethod:method,createdAt:now,createdBy:actor}:{type:'paid',amount:cut,method,rateUsdPer1000:rate,usdcAmount:method==='usdc'?Math.round(cut*rate/10)/100:0,createdAt:now,createdBy:actor};
 Object.assign(r,{paid:!reopen,paidAmount:reopen?0:cut,paidAt:reopen?null:now,paidBy:reopen?null:actor});
 if(!reopen)r.paidRateUsdPer1000=rate;
 if(r.submission?.submittedAt)r.submission.status=reopen?'submitted':'paid';
 for(const [id,a] of Object.entries(run.auctions||{}))if(a.status==='sold'&&attendanceCharacterIdentity(settlementWinner(a))===attendanceCharacterIdentity(r.name)){
  a.paid=!reopen;s.payments??={};s.payments[id]??={};s.payments[id].settled=!reopen;
 }
 return run;
}
async function dashboardSavePaid(entry,reopen=false){
 if(!isRL)throw Error('Leader access required.');
 const s=settlementsDashboardRuns[entry.key]?.settlement,r=s?.raiders?.[entry.raiderKey];
 if(!s||!r)throw Error('Payout is no longer available.');
 if(['coin','mixed'].includes(s.settlementMode)){
  if(reopen)throw Error('A credited payout cannot be undone here. Use a cut adjustment for an additional payment.');
  const method=r.gsPayoutMethod||(!s.payoutMethods?'gs':null);
  if(!method)throw Error('The raider must choose a payout method first.');
  const data={runId:entry.key,raiderKey:entry.raiderKey,expectedMethod:method,expectedAmount:Number((Number(r.gsCut||0)-Number(r.gsCredited||0)).toFixed(6))};
  if(method==='gold'){
   const rate=s.payoutUsdPer1000,quote=typeof rate==='number'&&Number.isFinite(rate)&&rate>0?{gold:data.expectedAmount*1000/rate,payoutRate:rate}:await gsCall('quoteGold',data);
   Object.assign(data,{goldDelivered:true,expectedGold:quote.gold,expectedPayoutRate:quote.payoutRate});
  }else if(method==='usd')data.externalPaid=true;
  // The regular queue's optimistic wrapper reads the displayed run; this view owns its own pending state.
  await fastPayoutCallOriginal('creditCut',data);
 }else{
  const expected={cut:dashboardLegacyCut(r),method:r.submission?.method||'manual',rate:Math.max(.01,Number(s.usdPer1000||s.usdcPer1000)||10)};
  const eventId=push(ref(db,`runs/${entry.key}/settlement/raiders/${entry.raiderKey}/payoutEvents`)).key,actor=user,now=Date.now();
  const result=await runTransaction(ref(db,`runs/${entry.key}`),run=>dashboardLegacyPayment(run,entry.raiderKey,expected,eventId,actor,now,reopen),{applyLocally:false});
  if(!result.committed||!result.snapshot.val())throw Error('Payment was not saved. Reload the payouts and retry.');
 }
}
async function dashboardMarkPaid(entry){
 const key=dashboardPaymentKey(entry);if(dashboardPayments.has(key))return;
 const pending={saved:false};dashboardPayments.set(key,pending);renderSettlementsDashboard();
 try{await dashboardSavePaid(entry);pending.saved=true;renderSettlementsDashboard();toast(entry.name+' marked paid');}
 catch(error){dashboardPayments.delete(key);renderSettlementsDashboard();dashboardPaymentError('Payment was not confirmed. The row has been restored. '+(error.message||'Check its status before retrying.'));}
}
function dashboardPaymentError(message){
 const dialog=document.getElementById('settlements-dashboard');if(!dialog){hybridError(message);return;}
 let error=dialog.querySelector('[data-payment-error]');
 if(!error){error=document.createElement('p');error.dataset.paymentError='';error.setAttribute('role','alert');dialog.prepend(error);}
 error.textContent=message;error.scrollIntoView({block:'nearest'});
}
function dashboardActionDialog(title,body,save){
 const dialog=document.createElement('dialog');dialog.className='dashboard-action-dialog';
 dialog.innerHTML=`<form><h2>${settlementEsc(title)}</h2>${body}<p role="status"></p><div class="uniform-actions">${save?'<button class="btn btn-gold" type="submit">Confirm</button>':''}<button class="btn btn-outline" type="button" data-close>Close</button></div></form>`;
 const close=()=>{dialog.close();dialog.remove();};
 dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(!save)return;const button=dialog.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;try{await save(dialog);close();}catch(error){dialog.querySelector('[role=status]').textContent=error.message||'Could not save';button.disabled=false;}};
 document.body.append(dialog);dialog.showModal();return dialog;
}
function dashboardPayoutAction(index,action){
 const entry=settlementsDashboardEntries[index];if(!isRL||!entry)return;
 if(action==='paid')return dashboardMarkPaid(entry);
 if(action==='open')return openDashboardSettlement(index);
 const s=settlementsDashboardRuns[entry.key]?.settlement,r=s?.raiders?.[entry.raiderKey];if(!r)return;
 const coin=['coin','mixed'].includes(s.settlementMode),path=`runs/${entry.key}/settlement/raiders/${entry.raiderKey}`;
 if(action==='reopenCut'){
  renderSettlementsDashboard();
  return dashboardActionDialog('Reopen '+entry.name+'?',`<p>${coin?'This payout has already been credited. Use Modify cut to add another payment.':'Return this cut to the unpaid queue. Its payment history will be retained.'}</p>`,coin?null:()=>dashboardSavePaid(entry,true));
 }
 if(action==='dispute')return dashboardActionDialog('Dispute: '+entry.name,`<p>${settlementEsc(r.cutRequest?.note||'No note')}</p><p>Use Open full payout to respond to this dispute.</p>`,null);
 const modify=action==='modify',correction=action==='correction';if(!modify&&!correction&&action!=='reopen')return;
 const body=modify?'<label>Adjustment amount ('+(coin?'USD equivalent':'gold')+')<input name="amount" type="number" step="any" required></label><label>Reason<input name="note" maxlength="200" required></label>':correction?'<label>Correction needed<input name="note" maxlength="240" required></label>':'<p>Reopen this claim for 24 hours?</p>';
 return dashboardActionDialog((modify?'Modify cut: ':correction?'Request correction: ':'Reopen claim: ')+entry.name,body,async dialog=>{
  if(!isRL)throw Error('Leader access required.');
  const note=dialog.querySelector('[name=note]')?.value.trim(),amount=Number(dialog.querySelector('[name=amount]')?.value);
  if((modify||correction)&&!note)throw Error('Enter a note.');
  if(modify&&(!Number.isFinite(amount)||!amount))throw Error('Enter a non-zero adjustment.');
  if(coin){await gsCall(modify?'adjustCut':'claimAdmin',{runId:entry.key,raiderKey:entry.raiderKey,...(modify?{amount,reason:note}:{action,note:note||''})});return;}
  const now=Date.now();
  if(modify){const writes={},id=push(ref(db,path+'/cutAdjustments')).key;writes['cutAdjustments/'+id]={amount,reason:note,createdAt:now,createdBy:user,updatedAt:now,updatedBy:user};if(r.submission?.submittedAt&&!r.paid){writes['submission/status']='correction';writes['submission/correctionNote']='Your cut changed. Review the new amount and resubmit your payout claim.';}await update(ref(db,path),writes);}
  else if(correction){if(!r.submission?.submittedAt||r.paid)throw Error('Select an unpaid submitted claim.');await update(ref(db,path+'/submission'),{status:'correction',correctionNote:note,correctionRequestedAt:now,correctionRequestedBy:user});}
  else await update(ref(db,path),{claimExtensionUntil:now+86400000});
 });
}
// A native child dialog remains above the native settlements modal.
openPayoutImageFromSource=function(src,alt='Claim attachment'){
 src=payoutSafeImage(src);if(!src)return;
 dashboardActionDialog(alt,`<img class="payout-review-image" src="${settlementEsc(src)}" alt="${settlementEsc(alt)}" style="max-height:75vh;max-width:100%">`,null);
};
const dashboardStyle=document.createElement('style');
dashboardStyle.textContent='.dashboard-action-dialog{width:min(900px,94vw);max-height:90vh;overflow:auto;background:var(--bg-card,#17140d);color:var(--text-bright);border:1px solid var(--gold);padding:24px}.dashboard-action-dialog::backdrop{background:#0009}.dashboard-action-dialog label{display:grid;gap:8px;margin:16px 0}.dashboard-action-dialog input{padding:12px;background:var(--bg-input);color:inherit;border:1px solid var(--gold)}.dashboard-row-actions label{white-space:nowrap;flex-shrink:0}.dashboard-row-actions input{flex-shrink:0}';
document.head.append(dashboardStyle);
dashboardStyle.textContent+='.dashboard-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:16px 0}.dashboard-total{padding:14px;border:1px solid var(--border-gold);background:var(--bg-input)}.dashboard-total strong{display:block;color:var(--gold);font-size:1.25rem;margin:6px 0}.dashboard-total>div{margin-top:4px}';
// Update age labels without rerendering or closing the user's disclosures.
setInterval(()=>{for(const label of document.querySelectorAll('#settlements-dashboard [data-claim-elapsed]'))label.textContent=settlementElapsedText(Number(label.dataset.claimElapsed));},60000);
