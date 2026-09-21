// Embedded into index.html by build.cjs. All GS mutations go through gsCommand.
const gsAuth=getAuth(fbApp),gsFunctions=getFunctions(fbApp,'us-central1');
const gsEndpoint='https://us-central1-'+firebaseConfig.projectId+'.cloudfunctions.net/gsDiscordAuth';
let gsSnapshot=null,gsPoll=null,gsBusy=false;
const gsContext=()=>['coin','mixed'].includes(settlement?.settlementMode);
const gsAmount=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:6})+' GC';
function gsVerify(){location.href=gsEndpoint;}

let gsReadyTask=null,gsReadyUid='';
function gsStartupNotice(message,retry){
 let el=document.getElementById('gs-startup-notice');
 if(!el){el=document.createElement('div');el.id='gs-startup-notice';el.className='settlement-section';el.setAttribute('role','status');document.body.append(el);el.style.cssText='position:fixed;bottom:16px;right:16px;z-index:250;max-width:360px;background:#19150d;padding:16px;border:1px solid #a78b42';}
 el.replaceChildren();const text=document.createElement('p');text.textContent=message;el.append(text);
 if(retry){const button=document.createElement('button');button.className='btn btn-outline';button.textContent='Retry';button.onclick=retry;el.append(button);}
}
async function gsStartupWait(task){
 let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Sign-in took too long. Please retry.')),15000);})]);}
 catch(e){gsStartupNotice('Could not finish sign-in. Please retry.',()=>location.reload());throw e;}
 finally{clearTimeout(timer);}
}
function gsEnsureReady(){
 const account=gsAuth.currentUser;if(!account)return Promise.reject(Error('Sign in with Discord first'));
 if(gsReadyUid!==account.uid){gsReadyUid=account.uid;gsReadyTask=null;}
 if(gsReadyTask)return gsReadyTask;
 gsReadyTask=(async()=>{
  const claims=(await account.getIdTokenResult()).claims;
  if(claims.raidLeader===true){
   const key='gdkp_setup_v2:'+firebaseConfig.projectId+':'+account.uid;
   let complete=false;try{complete=localStorage.getItem(key)==='complete';}catch{}
   if(!complete){
    gsStartupNotice('Preparing raid tools. The page is available while setup finishes.');
    for(const op of ['manualInitialize','migrateAttendanceCodes']){
     if(gsAuth.currentUser?.uid!==account.uid)throw Error('Account changed. Sign in again.');
     await httpsCallable(gsFunctions,'gsCommand')({op,data:{},id:crypto.randomUUID()});
    }
    try{localStorage.setItem(key,'complete');}catch{}
   }
  }
  if(gsAuth.currentUser?.uid!==account.uid)throw Error('Account changed. Sign in again.');
  document.getElementById('gs-startup-notice')?.remove();
 })().catch(e=>{gsReadyTask=null;gsStartupNotice('Raid tools could not finish loading. Bids and payments must wait for setup.',()=>{gsEnsureReady().then(()=>gsRefresh()).catch(()=>{});});throw e;});
 return gsReadyTask;
}

async function gsCall(op,data={},id){
  await gsEnsureReady();
  if(!gsAuth.currentUser)throw Error('Verify Discord first');
  const token=await gsAuth.currentUser.getIdTokenResult();if(String(token.claims.discordId)!==accountDiscordId())throw Error('Discord account changed. Verify again.');
  const payload=JSON.stringify([accountDiscordId(),op,data]),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)),key='v3:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),read=['snapshot','quoteGold','prepareClaimImage'].includes(op),pending=JSON.parse(sessionStorage.getItem('gs_pending_ops')||'{}');
  id=id||(read?crypto.randomUUID():pending[key]||pending[payload]||crypto.randomUUID());if(pending[payload])delete pending[payload];if(!read){pending[key]=id;sessionStorage.setItem('gs_pending_ops',JSON.stringify(pending));}
  const requestStarted=performance.now();try{const response=(await httpsCallable(gsFunctions,'gsCommand')({op,data,id})).data;console.info('Request timing',{op,totalMs:Math.round(performance.now()-requestStarted)});if(!read){const latest=JSON.parse(sessionStorage.getItem('gs_pending_ops')||'{}');if(latest[key]===id)delete latest[key];sessionStorage.setItem('gs_pending_ops',JSON.stringify(latest));}return response;}catch(e){if(!read&&!['functions/unavailable','functions/deadline-exceeded','functions/internal','functions/unknown'].includes(e.code)){const latest=JSON.parse(sessionStorage.getItem('gs_pending_ops')||'{}');if(latest[key]===id)delete latest[key];sessionStorage.setItem('gs_pending_ops',JSON.stringify(latest));}throw e;}
}
async function gsRefresh(){try{gsSnapshot=await gsCall('snapshot');const el=document.getElementById('gs-account-state');if(el)el.innerHTML=gsAccountState();const queue=document.getElementById('gs-admin-queue');if(queue)queue.innerHTML=gsAdminQueue();}catch(e){const el=document.getElementById('gs-account-state');if(el)el.textContent=e.message;}}
async function gsAction(op,data={},confirmText=''){
  if(gsBusy)return;
  const perform=async()=>{if(gsBusy)return;gsBusy=true;try{await gsCall(op,data);if(document.querySelector('#gs-account-state,#gs-admin-queue,[data-gc-available]'))void gsRefresh();toast('GS change recorded');if(tab==='settlement'||tab==='payout')renderMain();}catch(e){toast(e.message||'GS save failed; nothing was credited');}finally{gsBusy=false;}};
  if(confirmText)wowConfirm({title:'Confirm GS Change',msg:confirmText,confirmLabel:'Confirm',onConfirm:perform});else await perform();
}
function gsField(id){return document.getElementById(id)?.value?.trim()||'';}
function gsForm(type){
  const forms={deposit:'<label>Amount USDC<input id="gs-amount" type="number" min="1" step=".000001"></label>',withdraw:'<label>Amount GS<input id="gs-amount" type="number" min=".000001" step=".000001"></label><label>Ethereum destination<input id="gs-address" autocomplete="off"></label>',configure:'<label>House Ethereum USDC address<input id="gs-address" autocomplete="off"></label>',float:'<label>Recipient Discord ID<input id="gs-to"></label><label>Amount GS<input id="gs-amount" type="number" min=".000001" step=".000001"></label>'};
  document.getElementById('gs-form')?.remove();const el=document.createElement('div');el.id='gs-form';el.className='account-payment-overlay';el.innerHTML=`<div class="account-payment-card"><div class="settlement-section-title">${{deposit:'Deposit USDC',withdraw:'Withdraw GS',configure:'House Settings',float:'Transfer Float'}[type]}</div><div class="gs-fields">${forms[type]}</div><div class="uniform-actions"><button class="btn btn-outline btn-sm" onclick="document.getElementById('gs-form').remove()">Cancel</button><button class="btn btn-gold btn-sm" onclick="gsSubmitForm('${type}')">Continue</button></div><div id="gs-form-result" role="status"></div></div>`;document.body.appendChild(el);
}
async function gsSubmitForm(type){
  if(gsBusy)return;gsBusy=true;const box=document.getElementById('gs-form-result');try{
    if(type==='deposit'){const d=await gsCall('depositRequest',{amount:Number(gsField('gs-amount')),runId});box.innerHTML=`<p>Send exactly <strong>${d.amount.toFixed(6)} USDC</strong> on Ethereum.</p><p>Tag: ${settlementEsc(d.tag)}</p><p class="gs-address">${settlementEsc(d.address)}</p><p>The six-decimal amount identifies this request. A text memo is not transmitted by USDC. Credit appears after confirmation or RL review.</p>`;}
    else{const op=type==='configure'?'configure':type==='float'?'floatTransfer':'withdraw',data=type==='configure'?{address:gsField('gs-address')}:type==='float'?{to:gsField('gs-to'),amount:Number(gsField('gs-amount'))}:{amount:Number(gsField('gs-amount')),address:gsField('gs-address')};gsBusy=false;await gsAction(op,data,type==='configure'?'Use this address for new USDC deposits?':type==='float'?'Transfer funded house GS to this account?':'Reserve these GS for a USDC withdrawal to the entered address?');}
    if(document.querySelector('#gs-account-state,#gs-admin-queue,[data-gc-available]'))void gsRefresh();
  }catch(e){box.textContent=e.message;}finally{gsBusy=false;}
}
function gsHelp(){const lines=settlement.gsCutLines||{lead:15,treasury:5,risk:5,handling:0};return '<p>Run compensation: '+Object.entries(lines).map(([k,v])=>settlementEsc(k)+' '+v+'%').join(' · ')+(settlement.gsTaper?' · capped at 20% of first 2,000 GS, 15% after.':'.')+' Withdrawal window: 48 hours after the run locks. Expiry fee: '+Number(settlement.gsHaircutPct||0)+'%.</p><details><summary>About Godspeed Coin</summary><p>1 GS = 1 USDC. New runs use coin. Gold is available only when the RL enables it for that mixed run. Each ticket keeps its creation rate through transfers. Remaining coin withdraws as USDC. Cuts are GS unless the run permits gold. A published withdrawal-window fee may apply after the run closes.</p></details>';}
function gsAccountState(){
  if(!gsSnapshot)return 'Loading GS account…';const a=gsSnapshot.account;
  return `<div class="account-stats"><div>Available<br><strong>${gsAmount(a.gsBalance)}</strong></div><div>Withdrawals pending<br>${gsAmount(Object.values(gsSnapshot.withdrawals||{}).filter(w=>w.owner===accountDiscordId()&&w.status==='pending').reduce((s,w)=>s+w.amount,0))}</div></div><div class="uniform-actions"><button class="btn btn-outline btn-sm" onclick="gsForm('deposit')" ${!gsSnapshot.config.enabled?'disabled':''}>Deposit</button><button class="btn btn-outline btn-sm" onclick="gsForm('withdraw')" ${!gsSnapshot.config.enabled?'disabled':''}>Withdraw</button><button class="btn btn-outline btn-sm" onclick="gsRefresh()">Refresh</button></div><details><summary>Tickets</summary>${Object.values(a.tickets).filter(t=>t.remainingUsd>0).sort((a,b)=>a.createdAt-b.createdAt).map(t=>`<p>${gsAmount(t.remainingUsd)} · rate ${t.rateUsdPer1000} USDC / 1,000g · ${settlementEsc(t.runId)} · ${t.expiresAt?'window ends '+accountDate(t.expiresAt):'window starts when run locks'}</p>`).join('')||'<p>No unused tickets.</p>'}</details><details><summary>Ledger</summary>${Object.values(a.ledger).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100).map(e=>`<p>${settlementEsc(e.type)} · ${gsAmount(e.gsDelta)} · ${accountDate(e.createdAt)}</p>`).join('')||'<p>No GS activity.</p>'}</details><details><summary>My payable wins</summary>${gsContext()?auctionList().filter(a=>a.status==='sold'&&Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>b.amount-a.amount)[0]?.discordId===accountDiscordId()&&settlement.gsPayments?.[a.id]?.status!=='paid').map(a=>`<p>${settlementEsc(a.name)} · ${gsAmount(a.currentBid)} <button class="btn btn-outline btn-sm" onclick="gsPay('${a.id}')">Pay GS</button></p>`).join(''):''}</details><details><summary>My requests</summary>${Object.entries(gsSnapshot.deposits||{}).filter(([,d])=>d.owner===accountDiscordId()).map(([id,d])=>`<p>${gsAmount(d.amount)} · ${settlementEsc(d.status)} · ${settlementEsc(d.tag)} ${d.status==='pending'?`<button class="btn btn-outline btn-sm" onclick="gsHash('${id}',false)">Submit Hash</button><button class="btn btn-outline btn-sm" onclick="gsAction('depositCancel',{id:'${id}'},'Cancel this request? Any later transfer will require RL matching.')">Cancel</button>`:''}</p>`).join('')}${Object.entries(gsSnapshot.withdrawals||{}).filter(([,w])=>w.owner===accountDiscordId()).map(([id,w])=>`<p>${gsAmount(w.amount)} · ${settlementEsc(w.status)} ${w.status==='pending'?`<button class="btn btn-outline btn-sm" onclick="gsAction('withdrawCancel',{id:'${id}'},'Cancel this pending withdrawal?')">Cancel</button>`:''}</p>`).join('')}</details>`;
}
function gsAccountSection(){return `<div class="user-settings-sec"><div class="user-settings-sec-label">Godspeed Coin</div>${gsAuth.currentUser?'<div id="gs-account-state">'+gsAccountState()+'</div>':'<p>Verify your Discord identity to access GC.</p><button class="btn btn-outline btn-sm" onclick="gsVerify()">Verify Discord</button>'}${gsHelp()}</div>`;}
function gsAdminQueue(){if(!gsSnapshot?.house)return '<p>Verify as RL to load treasury.</p>';return `<p>House float: ${gsAmount(gsSnapshot.house.balance)} · reserve: ${gsSnapshot.house.reserved} USDC</p><div class="uniform-actions"><button class="btn btn-outline btn-sm" onclick="gsForm('configure')">Wallet Settings</button><button class="btn btn-outline btn-sm" onclick="gsForm('float')">Transfer Float</button><button class="btn btn-outline btn-sm" onclick="gsRefresh()">Refresh</button></div><h4>Deposits awaiting confirmation</h4>${Object.entries(gsSnapshot.deposits||{}).filter(([,d])=>d.status==='pending').map(([id,d])=>`<p>${settlementEsc(d.owner)} · ${gsAmount(d.amount)} · ${settlementEsc(d.tag)} <button class="btn btn-outline btn-sm" onclick="gsHash('${id}',true)">Mark Received</button></p>`).join('')||'<p>None</p>'}<h4>Withdrawals awaiting USDC payment</h4>${Object.entries(gsSnapshot.withdrawals||{}).filter(([,w])=>w.status==='pending').map(([id,w])=>`<p>${settlementEsc(w.owner)} · ${w.amount} USDC<br><span class="gs-address">${settlementEsc(w.address)}</span><button class="btn btn-outline btn-sm" onclick="gsHash('${id}',true,true)">Record Payment</button><button class="btn btn-outline btn-sm" onclick="gsAction('withdrawCancel',{id:'${id}'},'Return reserved GS to the member?')">Cancel</button></p>`).join('')||'<p>None</p>'}<details><summary>Unmatched transfers</summary>${Object.values(gsSnapshot.unmatched||{}).map(e=>`<p>${e.amount} USDC · ${settlementEsc(e.hash)} · log ${e.logIndex}<br>${settlementEsc(e.reason||e.error||'Needs review')}</p>`).join('')||'<p>None</p>'}</details>`;}
function gsHash(id,admin,withdraw=false){wowConfirm({title:withdraw?'USDC Payment Receipt':'USDC Deposit Receipt',msg:admin?'Enter the transaction hash followed by a space and Transfer log index. The server verifies the amount, network, token, recipient and confirmations.':'Enter the transaction hash for RL review.',confirmLabel:'Submit',input:{type:'text',placeholder:'0x… 0',errorMsg:'Enter transaction hash'},onConfirm:v=>{const [hash,index]=v.trim().split(/\s+/);gsAction(admin?(withdraw?'withdrawPaid':'receive'):'submitHash',{id,hash,logIndex:Number(index)});}});}
function gsMatchDeposit(){wowConfirm({title:'Match Deposit / Mint Override',msg:'Enter Discord ID, transaction hash, log index, then optionally mint to bypass float. Only a verified, unused USDC receipt can create GS.',confirmLabel:'Review Receipt',input:{type:'text',placeholder:'DiscordID 0x… 0',errorMsg:'Enter recipient and receipt'},onConfirm:v=>{const [owner,hash,index,mode]=v.trim().split(/\s+/);gsAction('assignDeposit',{owner,hash,logIndex:Number(index),forceMint:mode==='mint',runId:settlementRunKey()},'Assign this verified deposit to the selected Discord account?');}});}
function gsHaircut(){wowConfirm({title:'Apply Published Haircut',msg:'Enter the Discord ID. Only unused tickets past their published deadline qualify; reserved withdrawals are excluded.',confirmLabel:'Review',input:{type:'text',placeholder:'Discord ID',errorMsg:'Enter Discord ID'},onConfirm:owner=>gsAction('haircut',{owner},'Apply the published expiry fee to eligible tickets?')});}
function gsSetup(){const s=settlement,l=s.gsCutLines||{lead:15,treasury:5,risk:5,handling:0};return `<details class="settlement-section"><summary>Godspeed Coin · Treasury & Run Settings</summary><div class="gs-fields"><label>Run mode<select id="gs-mode"><option value="coin" ${s.settlementMode!=='mixed'?'selected':''}>Coin</option><option value="mixed" ${s.settlementMode==='mixed'?'selected':''}>Mixed</option></select></label><label>USDC per 1,000g<input id="gs-rate" type="number" min=".01" step=".01" value="${runUsdRate()}"></label>${Object.entries(l).map(([k,v])=>`<label>${k} %<input id="gs-line-${k}" type="number" min="0" max="100" step=".01" value="${v}"></label>`).join('')}<label><input type="checkbox" id="gs-gold" ${s.goldEnabled?'checked':''}> Gold / AH handling this run</label><label><input type="checkbox" id="gs-taper" ${s.gsTaper?'checked':''}> Cap fees at 20% of first 2,000 GS and 15% thereafter</label><label>Expired-ticket haircut<select id="gs-haircut">${[0,5,10].map(n=>`<option ${Number(s.gsHaircutPct||0)===n?'selected':''}>${n}</option>`).join('')}</select></label></div><button class="btn btn-outline btn-sm" onclick="gsSaveMode()">Apply & Lock</button><p>Mode changes require an empty current run. New runs default to coin. The withdrawal window is 48 hours after cuts lock.</p><div id="gs-admin-queue">${gsAdminQueue()}</div></details>`;}
function gsSaveMode(){const lines=Object.fromEntries(['lead','treasury','risk','handling'].map(k=>[k,Number(gsField('gs-line-'+k))]));gsAction('mode',{runId:settlementRunKey(),mode:gsField('gs-mode'),rate:Number(gsField('gs-rate')),lines,haircut:Number(gsField('gs-haircut')),goldEnabled:document.getElementById('gs-gold').checked,taper:document.getElementById('gs-taper').checked},'Apply this run’s mode, ticket rate, compensation and withdrawal-window fee?');}
function gsCollections(){return auctionList().filter(a=>a.status==='sold').map(a=>{const p=settlement.gsPayments?.[a.id],paid=p?.status==='paid';return `<div class="purchase-collection-card"><div class="purchase-person">${settlementEsc(a.name)}<p>${settlementEsc(settlementWinner(a))} · ${gsAmount(a.currentBid)}</p></div><div class="purchase-actions"><span>${paid?'Received ('+p.method+')':'Payable'}</span>${!paid?`<button class="btn btn-green btn-sm" onclick="gsPay('${a.id}')">Collect GS</button>${settlement.settlementMode==='mixed'&&settlement.goldEnabled?`<label><input type="checkbox" id="gs-gold-${a.id}"> Gold received</label>`:''}`:`<button class="btn btn-outline btn-sm" onclick="gsAction('refundWin',{runId:settlementRunKey(),auctionId:'${a.id}',goldReturned:${p.method==='gold'}},'Reverse this payment? Confirm any collected gold has been returned.')">Reverse</button>`}</div></div>`;}).join('');}
function gsPay(id){gsAction('payWin',{runId:settlementRunKey(),auctionId:id,gold:!!document.getElementById('gs-gold-'+id)?.checked},'Collect this won item using the winner’s available GS? Gold receipts use funded house GS for the pot.');}
function gsPayoutQueue(raiders,calc){return `<div class="settlement-section" id="payout-queue"><div class="settlement-section-title">Payout Queue</div>${raiders.map(r=>`<div class="gs-payout-row"><span>${settlementEsc(r.name)} · ${gsAmount(r.gsCut??calc.cuts[r.key])} · credited ${gsAmount(r.gsCredited||0)}</span><div class="uniform-actions"><button class="btn btn-green btn-sm" ${!settlement.payoutStarted||Number(r.gsCredited||0)>=Number(r.gsCut||0)?'disabled':''} onclick="gsCredit('${r.key}')">${r.gsPayoutMethod==='gold'?'Record Gold':'Credit GS'}</button>${r.cutRequest?`<button class="btn btn-outline btn-sm" onclick="openCutRequestReview('${r.key}')">Dispute</button>`:''}<button class="btn btn-outline btn-sm" ${!settlement.payoutStarted?'disabled':''} onclick="gsAdjust('${r.key}')">Modify Cut</button></div></div>`).join('')}</div>`;}
function gsAdjust(key){wowConfirm({title:'Modify GS Cut',msg:'Enter a signed GS amount and a reason, separated by a space. Positive adjustments use funded house float and affect only this raider.',confirmLabel:'Continue',input:{type:'text',placeholder:'5 Bonus',errorMsg:'Enter amount and reason'},onConfirm:v=>{const [amount,...reason]=v.trim().split(/\s+/);gsAction('adjustCut',{runId:settlementRunKey(),raiderKey:key,amount:Number(amount),reason:reason.join(' ')},'Apply this adjustment to the selected cut?');}});}
async function gsCredit(key){const data={runId:settlementRunKey(),raiderKey:key};if(settlement.raiders?.[key]?.gsPayoutMethod==='gold'){try{const quote=await gsCall('quoteGold',data);gsAction('creditCut',{...data,goldDelivered:true,expectedGold:quote.gold,expectedPayoutRate:quote.payoutRate},'Record delivery of '+quote.gold.toFixed(2)+' gold using the original ticket rates?');}catch(e){toast(e.message);}}else gsAction('creditCut',data,'Credit the locked GS cut to this member?');}
function gsMyPayout(){const r=payoutCurrentRaider();return `<div class="payout-claim"><div class="settlement-section"><div class="settlement-section-title">My Payout · GS</div><p>${r?gsAmount(r.gsCut??calculateSettlementCuts().cuts[r.key]):'Attendance has not been linked to a cut yet.'}</p><p>${r?.paid?'Credited to your GS account.':'Awaiting settlement credit.'}</p>${r?`<button class="btn btn-outline btn-sm" onclick="openCutRequest()">Dispute Cut</button>`:''}<button class="btn btn-outline btn-sm" onclick="openUserSettings()">Balance & Withdraw</button>${r&&settlement.settlementMode==='mixed'&&settlement.goldEnabled?`<div class="uniform-actions"><button class="btn btn-outline btn-sm" onclick="gsAction('payoutChoice',{runId:settlementRunKey(),raiderKey:'${r.key}',method:'gs'})">Choose GS</button><button class="btn btn-outline btn-sm" onclick="gsAction('payoutChoice',{runId:settlementRunKey(),raiderKey:'${r.key}',method:'gold'})">Choose Gold</button></div>`:''}${gsHelp()}</div></div>`;}
// Hooks retain legacy behavior for every run without an explicit settlementMode.
const gsOldAccount=openUserSettings;openUserSettings=function(){gsOldAccount();const node=document.querySelector('.user-settings-wrap');if(node)node.insertAdjacentHTML('afterbegin',gsAccountSection());gsRefresh();};
const gsOldCollections=calculateSettlementCollections;calculateSettlementCollections=function(){if(!gsContext())return gsOldCollections();const sold=auctionList().filter(a=>a.status==='sold'),paid=Object.values(settlement.gsPayments||{}).filter(p=>p.status==='paid'),sum=paid.reduce((s,p)=>s+p.amount,0);return{sold:sold.reduce((s,a)=>s+a.currentBid,0),expected:sold.reduce((s,a)=>s+a.currentBid,0),credited:sum,collected:sum,fee:0,settled:paid.length,purchasers:sold.length};};
const gsOldCuts=calculateSettlementCutsFrom;calculateSettlementCutsFrom=function(state=settlement){if(!gsContext())return gsOldCuts(state);return GS_CALCULATE(state,calculateSettlementCollections().credited);};
const gsOldDisplay=displayMoney;displayMoney=function(n,rate=runUsdRate()){if(!gsContext())return gsOldDisplay(n,rate);return settlement.settlementMode==='mixed'?gsAmount(n)+' / '+Math.floor(Number(n)*1000/rate).toLocaleString()+'g':displayCurrency==='usd'?usdText(Number(n)):gsAmount(n);};
const gsOldGold=goldText;goldText=function(n){return gsContext()?gsAmount(n):gsOldGold(n);};
const gsOldPayoutText=payoutAmountText;payoutAmountText=function(r,n,method){return gsContext()?gsAmount(n):gsOldPayoutText(r,n,method);};
const gsOldEffective=effectiveRaiderCut;effectiveRaiderCut=function(r,calc=calculateSettlementCuts()){return gsContext()?Number(r.gsCut??calc.cuts[r.key]??0):gsOldEffective(r,calc);};
const gsOldDue=payoutStillDue;payoutStillDue=function(r,cut=effectiveRaiderCut(r)){return gsContext()?Math.max(0,Math.round((cut-Number(r.gsCredited||0))*1e6)/1e6):gsOldDue(r,cut);};
const gsOldQueue=renderPayoutSubmissionQueue;renderPayoutSubmissionQueue=function(r,c){return gsContext()?gsPayoutQueue(r,c):gsOldQueue(r,c);};
const gsOldMy=renderMyPayoutBody;renderMyPayoutBody=function(){return gsContext()?gsMyPayout():gsOldMy();};
const gsOldRender=renderSettlement;renderSettlement=function(){const html=gsOldRender();if(!gsContext())return gsSetup()+html;const template=document.createElement('template');template.innerHTML=html;const collection=template.content.querySelector('.purchase-collection-list');if(collection)collection.innerHTML=gsCollections();template.content.querySelectorAll('.cut-setup-controls input').forEach(el=>el.disabled=true);return gsSetup()+template.innerHTML.replaceAll('Gold accounting value','GS value').replaceAll('gold equivalent still unpaid','GS still unpaid').replaceAll('Flat gold','Flat GS').replaceAll('Adjust g','Adjust GS').replaceAll('<div class="lbl">Gold</div>','<div class="lbl">GS</div>');};
const gsOldLock=toggleSettlementLock;toggleSettlementLock=function(){if(!gsContext()||settlement.payoutStarted)return gsOldLock();gsAction('lockCuts',{runId:settlementRunKey()},'Collect all sold items, lock cuts, and credit the published management lines?');};
const gsOldPaid=setPayoutPaid;setPayoutPaid=function(key,paid){if(!gsContext())return gsOldPaid(key,paid);if(paid)gsCredit(key);else toast('GC credits remain in the ledger. Use Modify Cut for an unpaid adjustment.');};
const gsOldAll=setAllPayoutsPaid;setAllPayoutsPaid=function(paid){if(!gsContext())return gsOldAll(paid);toast('Confirm each payout separately.');};
const gsOldTogglePaid=togglePaid;togglePaid=function(id){if(!gsContext())return gsOldTogglePaid(id);gsPay(id);};
const gsOldMigration=ensureLockedCutSnapshot;ensureLockedCutSnapshot=async function(){if(!gsContext())return gsOldMigration();};
const gsOldAccountTotal=accountLedgerTotal;accountLedgerTotal=function(data=accountData){return gsOldAccountTotal({...data,ledger:Object.fromEntries(Object.entries(data.ledger||{}).filter(([,e])=>e.unit!=='GS'))});};

let gsDisplayRun='';const gsOldHeader=renderHdr;renderHdr=function(){if(gsContext()&&gsDisplayRun!==settlementRunKey()){gsDisplayRun=settlementRunKey();displayCurrency='gold';}gsOldHeader();if(gsContext()){const buttons=document.querySelectorAll('#hdr-user .currency-toggle button');if(buttons[1]){buttons[1].textContent='GS';buttons[1].title='Show GS';}document.querySelector('#hdr-user .header-rate-button')?.setAttribute('title','Ticket rate for this run');}};
const gsOldTasks=collectSettlementTasks;collectSettlementTasks=function(runs,key){const out=gsOldTasks(runs,key).filter(e=>!['coin','mixed'].includes(runs?.[e.key]?.settlement?.settlementMode));for(const [id,run] of Object.entries(runs||{})){const s=run?.settlement;if(!s||!['coin','mixed'].includes(s.settlementMode)||(!run.archived&&id!==key))continue;for(const [raiderKey,r] of Object.entries(s.raiders||{})){const due=Number(r.gsCut||0)-Number(r.gsCredited||0),dispute=r.cutRequest?.status==='pending';if(!dispute&&(!s.payoutStarted||due<=0))continue;out.push({key:id,raiderKey,name:r.name||raiderKey,title:run.settings?.raidTitle||'Untitled Run',date:run.createdAt||0,archived:!!run.archived,category:dispute?'dispute':'gs',amount:gsAmount(due),note:r.cutRequest?.note||'',hasProof:!!r.cutRequest?.hasAttachment});}}return out;};
const gsOldBid=submitBid;submitBid=function(id,val,event){if(!gsContext())return gsOldBid(id,val,event);gsAction('placeBid',{runId,auctionId:id,amount:Number(val)});};
// Verified OAuth becomes the sign-in route for this release, including legacy UI.
joinDiscord=gsVerify;
const gsOldDelete=deleteRun;deleteRun=async function(key){const data=(await get(ref(db,'runs/'+key))).val();if(data?.settlement?.settlementMode){toast('Coin runs retain their ledger. Archive this run instead.');return;}return gsOldDelete(key);};
const gsOldSubmitAdjustment=submitCutAdjustment;submitCutAdjustment=function(...args){if(gsContext()){toast('Use Modify Cut in the GS payout queue.');return;}return gsOldSubmitAdjustment(...args);};
const gsOldRunBonus=submitRaiderBonus;submitRaiderBonus=function(...args){if(gsContext()){toast('Use Modify Cut in the GS payout queue.');return;}return gsOldRunBonus(...args);};
const gsOldLogout=logout;logout=function(){clearInterval(gsPoll);gsSnapshot=null;signOut(gsAuth);gsOldLogout();};
const gsAdminQueueBase=gsAdminQueue;gsAdminQueue=function(){return gsAdminQueueBase()+(isRL?'<div class="uniform-actions"><button class="btn btn-outline btn-sm" onclick="gsMatchDeposit()">Match Deposit</button><button class="btn btn-outline btn-sm" onclick="gsHaircut()">Expired Tickets</button><button class="btn btn-outline btn-sm" onclick="gsClosePot()">Return Remainder</button></div>':'');};
Object.assign(window,{openUserSettings,toggleSettlementLock,setPayoutPaid,setAllPayoutsPaid,togglePaid,openModal,logout,joinDiscord,deleteRun,submitCutAdjustment,submitRaiderBonus,gsVerify,gsForm,gsSubmitForm,gsAction,gsHash,gsSaveMode,gsRefresh,gsPay,gsAdjust,gsCredit,gsMatchDeposit,gsHaircut,gsClosePot,settlementRunKey});
onAuthStateChanged(gsAuth,()=>{gsSnapshot=null;clearInterval(gsPoll);if(gsAuth.currentUser){setTimeout(()=>gsRefresh(),0);gsPoll=setInterval(()=>{if(document.visibilityState==='visible'&&!gsBusy&&!uiPendingCommands.size&&(document.getElementById('gs-account-state')||document.getElementById('gs-admin-queue')||document.querySelector('[data-gc-available]')))gsRefresh();},20000);}});
const gsFragment=new URLSearchParams(location.hash.slice(1));
if(gsFragment.has('gs_token')){const token=gsFragment.get('gs_token'),profile=JSON.parse(gsFragment.get('gs_user')||'{}');history.replaceState({},'',location.pathname+location.search);try{await signInWithCustomToken(gsAuth,token);const verified=await gsAuth.currentUser.getIdTokenResult();if(String(verified.claims.discordId)!==String(profile.id))throw Error('Identity mismatch');localStorage.setItem('gdkp_discord',JSON.stringify(profile));localStorage.setItem('gdkp_user',profile.displayName||profile.username);localStorage.setItem('gdkp_isRL',verified.claims.raidLeader?'1':'0');}catch(e){await signOut(gsAuth);toast('GS verification failed. Retry Discord login.');}}
await gsStartupWait(gsAuth.authStateReady());
const gsVerifiedClaims=gsAuth.currentUser?(await gsStartupWait(gsAuth.currentUser.getIdTokenResult())).claims:{};
const gsPrivateCodes={};
// Render the authenticated page before calling the backend. gsCall gates operations on setup.
setTimeout(()=>{if(gsAuth.currentUser)gsEnsureReady().then(()=>gsRefresh()).catch(()=>{});},0);

function gsClosePot(){gsAction('closePot',{runId:settlementRunKey()},'Return only the remaining escrow GS after all raider cuts are credited?');}

// GC display patch. Internal GS ledger keys remain unchanged.
let gcGoldView=false;
const gcOldSummary=renderPurchaseSummary;
renderPurchaseSummary=function(group,compact=false){
 if(!gsContext())return gcOldSummary(group,compact);
 const due=group.items.filter(a=>settlement.gsPayments?.[a.id]?.status!=='paid').reduce((sum,a)=>sum+Number(a.currentBid||0),0);
 return `<div class="purchase-summary gc-payment"><div><strong>${due?'Amount owed':'Payment complete'}</strong><span class="settlement-status ${due?'warn':'ok'}">${due?'Awaiting payment':'Paid'}</span></div><p class="gc-payment-amount">${gsAmount(due)}</p>${due?`<p class="settlement-muted">${Number(due).toLocaleString(undefined,{maximumFractionDigits:6})} USDC equivalent</p><button class="btn btn-outline btn-sm" onclick="openUserSettings()">Balance & Payment</button>`:''}</div>`;
};
const gcOldPaymentDialog=openPurchasePaymentDialog;
openPurchasePaymentDialog=function(key){if(gsContext()){openUserSettings();return;}return gcOldPaymentDialog(key);};
window.openPurchasePaymentDialog=openPurchasePaymentDialog;
const gcPreviousDisplay=displayMoney;
displayMoney=function(n,rate=runUsdRate()){
 if(!gsContext())return gcPreviousDisplay(n,rate);
 if(gcGoldView&&settlement.settlementMode==='mixed'&&settlement.goldEnabled)return (Number(n)*1000/Number(rate)).toLocaleString(undefined,{maximumFractionDigits:2})+'g';
 return displayCurrency==='usd'?usdText(Number(n)):gsAmount(n);
};
const gcPreviousSetCurrency=setDisplayCurrency;
setDisplayCurrency=function(next){
 if(!gsContext())return gcPreviousSetCurrency(next);
 if(next==='goldunit'&&!(settlement.settlementMode==='mixed'&&settlement.goldEnabled))return;
 gcGoldView=next==='goldunit';displayCurrency=next==='usd'?'usd':'gold';
 localStorage.setItem('gdkp_display_currency',displayCurrency);renderHdr();renderMain();toast(gcGoldView?'Showing gold':displayCurrency==='usd'?'Showing dollars':'Showing GC');
};window.setDisplayCurrency=setDisplayCurrency;
const gcPreviousHeader=renderHdr;
renderHdr=function(){gcPreviousHeader();if(!gsContext())return;const el=document.querySelector('#hdr-user .currency-toggle');if(!el)return;
 const enabled=settlement.settlementMode==='mixed'&&settlement.goldEnabled;
 el.classList.add('gc-currency');el.innerHTML=`<button onclick="setDisplayCurrency('usd')" title="Show dollars" class="${displayCurrency==='usd'&&!gcGoldView?'active':''}">$</button><button onclick="setDisplayCurrency('gc')" title="Show Godspeed Coin" aria-label="Show Godspeed Coin (GC)" class="${displayCurrency!=='usd'&&!gcGoldView?'active':''}"><span class="gc-coin-icon" aria-hidden="true">GC</span></button><button onclick="setDisplayCurrency('goldunit')" title="${enabled?'Show gold':'Gold is disabled for this raid'}" ${enabled?'':'disabled'} class="${gcGoldView&&enabled?'active':''}">&#128176;</button>`;
};
const gcPreviousSettlement=renderSettlement;
renderSettlement=function(){const html=gcPreviousSettlement();if(!gsContext())return html;return html.replaceAll('After fees and USDC discounts','Sold item total').replaceAll('Only RL-confirmed receipts','Collected coin').replaceAll("One record per purchaser. The site records the RL's confirmation and does not move funds.",'Collect each purchase from the winner’s coin balance.').replaceAll('Collect GS','Collect GC').replaceAll('Credit GS','Credit GC');};

// Raider-authorized coin payments v1.
function gcWinnerId(a){return String(Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>b.amount-a.amount||a.ts-b.ts)[0]?.discordId||'');}
gsPay=async function(id){
 if(gsBusy)return;
 const a=auctionList().find(a=>a.id===id);
 if(!a||gcWinnerId(a)!==String(accountDiscordId())){toast('Only the winning raider can pay for this item.');return;}
 try{
 gsSnapshot=await gsCall('snapshot');
 const amount=Number(a.currentBid),available=Number(gsSnapshot.account?.gsBalance||0);
 if(available<amount){toast('Add funds to pay for this item.');openUserSettings();return;}
 gsAction('payWin',{runId:settlementRunKey(),auctionId:id,expectedAmount:amount},'Pay '+gsAmount(amount)+' for '+a.name+'? Your remaining balance will be '+gsAmount(available-amount)+'.');
 }catch(e){toast(e.message);}
};window.gsPay=gsPay;
const gcSelfOldSummary=renderPurchaseSummary;
renderPurchaseSummary=function(group,compact=false){
 if(!gsContext())return gcSelfOldSummary(group,compact);
 const items=group.items.filter(a=>settlement.gsPayments?.[a.id]?.status!=='paid');
 const due=items.reduce((s,a)=>s+Number(a.currentBid||0),0);
 return `<div class="purchase-summary gc-payment"><strong>${due?'Amount owed':'Payment complete'}</strong><p class="gc-payment-amount">${gsAmount(due)}</p>${items.filter(a=>gcWinnerId(a)===String(accountDiscordId())).map(a=>`<p>${settlementEsc(a.name)} <button class="btn btn-green" onclick="gsPay('${a.id}')">Pay ${gsAmount(a.currentBid)}</button></p>`).join('')}${due?'<button class="btn btn-outline btn-sm" onclick="openUserSettings()">Add funds / Account</button>':''}</div>`;
};
gsCollections=function(){return auctionList().filter(a=>a.status==='sold').map(a=>{const p=settlement.gsPayments?.[a.id],paid=p?.status==='paid';return `<div class="purchase-collection-card"><div class="purchase-person">${settlementEsc(a.name)}<p>${settlementEsc(settlementWinner(a))} · ${gsAmount(a.currentBid)}</p></div><div class="purchase-actions"><span>${paid?'Paid':'Awaiting raider payment'}</span>${paid?`<button class="btn btn-outline btn-sm" onclick="gsAction('refundWin',{runId:settlementRunKey(),auctionId:'${a.id}',goldReturned:${p.method==='gold'}},'Refund this purchase? Confirm any gold received has been returned.')">Refund</button>`:settlement.settlementMode==='mixed'&&settlement.goldEnabled?`<button class="btn btn-outline btn-sm" onclick="gsAction('payWin',{runId:settlementRunKey(),auctionId:'${a.id}',gold:true},'Confirm you received the in-game gold. This uses house backing for the pot.')">Record gold received</button>`:''}</div></div>`;}).join('');};
const gcSelfOldSettlement=renderSettlement;
renderSettlement=function(){return gcSelfOldSettlement().replaceAll('Collect each purchase from the winner’s coin balance.','Raiders authorize their own coin payments.');};
const gcSelfOldAccount=gsAccountState;
gsAccountState=function(){return gcSelfOldAccount().replaceAll('My payable wins','Unpaid purchases').replaceAll('Pay GS','Pay GC');};

// Godspeed interface refresh v1.
const gcEsc=settlementEsc;
function gcMoney(n){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:6})+' GC';}
function gcSetText(size){const value=['standard','large','larger'].includes(size)?size:'standard';document.documentElement.dataset.gcText=value;localStorage.setItem('gc-text-size',value);}
gcSetText(localStorage.getItem('gc-text-size')||'standard');window.gcSetText=gcSetText;
const gcRefreshPot=buildPotBarHTML;
buildPotBarHTML=function(){let html=gcRefreshPot();if(isRL)html=html.replace('<div class="pot-bar-actions">','<div class="pot-bar-actions"><button class="btn btn-outline" onclick="openAttendanceManager()">Attendance</button>');return html;};
const gcRefreshHeader=renderHdr;
renderHdr=function(){gcRefreshHeader();let el=document.getElementById('gc-text-control');if(!el){const host=document.getElementById('hdr-user');if(host){el=document.createElement('div');el.id='gc-text-control';el.className='gc-text-control';host.appendChild(el);}}if(el)el.innerHTML='<label for="gc-text-size">Text size</label><select id="gc-text-size" onchange="gcSetText(this.value)">'+['standard','large','larger'].map(x=>'<option value="'+x+'" '+(document.documentElement.dataset.gcText===x?'selected':'')+'>'+x[0].toUpperCase()+x.slice(1)+'</option>').join('')+'</select>';};
function gcAvailable(){return gsSnapshot?.account?gcMoney(gsSnapshot.account.gsBalance):'Loading…';}
function gcRequestsHTML(){
 const owner=String(accountDiscordId());
 const list=[...Object.entries(gsSnapshot?.withdrawals||{}).filter(([,w])=>String(w.owner)===owner&&w.status==='pending').map(([id,w])=>({id,op:'withdrawCancel',name:'Withdrawal',amount:w.amount,address:w.address})),...Object.entries(gsSnapshot?.deposits||{}).filter(([,d])=>String(d.owner)===owner&&d.status==='pending').map(([id,d])=>({id,op:'depositCancel',name:'Deposit',amount:d.amount,address:d.address}))];
 return list.map(r=>`<div class="gc-request-row"><div><strong>${r.name} · ${gcMoney(r.amount)}</strong><small>Pending</small>${r.address?`<small class="gc-address">${gcEsc(r.address)}</small>`:''}</div><button class="btn btn-outline" onclick="gsAction('${r.op}',{id:'${r.id}'},'Cancel this ${r.name.toLowerCase()} request?')">Cancel request</button>${r.name==='Deposit'?`<button class="btn btn-outline" onclick="gsHash('${r.id}',false)">Add transaction hash</button>`:''}</div>`).join('')||'<p class="gc-empty">No pending requests.</p>';
}
function gcHistoryName(e){if(e.reason)return e.reason.replaceAll('GS','GC');return ({bid:'Purchase payment',cut:'Raid payout',deposit:'Deposit',mint:'Deposit credit',withdraw:'Withdrawal',withdrawCancel:'Withdrawal cancelled',transfer:'Transfer',refund:'Refund'})[e.type]||String(e.type||'Account activity').replaceAll('_',' ');}
gsAccountState=function(){
 if(!gsSnapshot?.account)return '<p class="gc-empty">Loading your account…</p>';
 const a=gsSnapshot.account,pending=Object.values(gsSnapshot.withdrawals||{}).filter(w=>String(w.owner)===String(accountDiscordId())&&w.status==='pending').reduce((s,w)=>s+Number(w.amount),0);
 const events=Object.values(a.ledger||{}).sort((a,b)=>b.createdAt-a.createdAt);
 return `<div class="gc-wallet-top"><div><span class="gc-label">Available funds</span><strong class="gc-value">${gcMoney(a.gsBalance)}</strong></div>${pending?`<div><span class="gc-label">Withdrawal pending</span><strong class="gc-value">${gcMoney(pending)}</strong></div>`:''}</div><div class="uniform-actions"><button class="btn btn-gold" onclick="gsForm('deposit')">Add funds</button><button class="btn btn-outline" onclick="gsForm('withdraw')">Withdraw</button></div><section class="gc-wallet-section"><h3>Pending requests</h3>${gcRequestsHTML()}</section><section class="gc-wallet-section"><h3>Transaction history</h3>${events.slice(0,100).map(e=>`<div class="gc-history-row"><div><strong>${gcEsc(gcHistoryName(e))}</strong><small>${gcEsc(accountDate(e.createdAt))}${e.method?' · '+gcEsc(e.method):''}</small></div><span class="gc-history-amount ${Number(e.gsDelta)>0?'gc-positive':''}">${Number(e.gsDelta)>0?'+':''}${gcMoney(e.gsDelta)}</span></div>`).join('')||'<p class="gc-empty">No transactions yet.</p>'}${events.length>100?'<p class="gc-empty">Showing the latest 100 transactions.</p>':''}</section><details class="gc-wallet-details" data-gc-key="ticket-details"><summary>Deposit details</summary>${Object.values(a.tickets||{}).filter(t=>Number(t.remainingUsd)>0).map(t=>`<p>${gcMoney(t.remainingUsd)}<br><small>${t.expiresAt?'Withdrawal window ends '+gcEsc(accountDate(t.expiresAt)):'Withdrawal window begins when the run locks.'}</small></p>`).join('')||'<p>No unused deposit lots.</p>'}</details>`;
};
const gcHelpOriginal=gsHelp;
gsHelp=function(){return '<details class="gc-wallet-details" data-gc-key="coin-help"><summary>Fees and withdrawal terms</summary>'+gcHelpOriginal().replaceAll('GS','GC')+'</details>';};
let gcRefreshing=false;
function gcReplacePreserving(el,html){
 if(!el||el.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select'))return;
 if(el.dataset.gcLastHtml===html)return;
 const open=[...el.querySelectorAll('details')].map((d,i)=>({key:d.dataset.gcKey||String(i),open:d.open}));
 const focused=document.activeElement,focusId=el.contains(focused)?focused.id:null;
 const scroll=[];for(let p=el;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight)scroll.push([p,p.scrollTop]);
 el.innerHTML=html;el.dataset.gcLastHtml=html;
 [...el.querySelectorAll('details')].forEach((d,i)=>{const old=open.find(o=>o.key===(d.dataset.gcKey||String(i)));if(old)d.open=old.open;});
 if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});scroll.forEach(([e,y])=>e.scrollTop=y);
}
gsRefresh=async function(){if(gcRefreshing||!gsAuth.currentUser)return;gcRefreshing=true;const owner=String(accountDiscordId());try{const snapshot=await gsCall('snapshot',{scope:document.getElementById('gs-admin-queue')?'admin':'account'});if(owner!==String(accountDiscordId()))return;gsSnapshot=snapshot;gcReplacePreserving(document.getElementById('gs-account-state'),gsAccountState());gcReplacePreserving(document.getElementById('gs-admin-queue'),gsAdminQueue());document.querySelectorAll('[data-gc-available]').forEach(el=>el.textContent=gcAvailable());}catch(e){const el=document.getElementById('gs-account-state');if(el&&!gsSnapshot)el.textContent=e.message;}finally{gcRefreshing=false;}};window.gsRefresh=gsRefresh;
const gcRefreshSummaryOld=renderPurchaseSummary;
renderPurchaseSummary=function(group,compact=false){if(!gsContext())return gcRefreshSummaryOld(group,compact);const due=group.items.filter(a=>settlement.gsPayments?.[a.id]?.status!=='paid'),total=due.reduce((n,a)=>n+Number(a.currentBid||0),0);return `<div class="purchase-summary gc-payment"><div class="gc-payment-top"><div><span class="gc-label">${total?'Amount owed':'Purchases'}</span>${total?`<strong class="gc-value">${gcMoney(total)}</strong>`:'<strong class="gc-value">All paid</strong>'}</div><div class="gc-balance-side"><span class="gc-label">Available funds</span><strong class="gc-value" data-gc-available>${gcAvailable()}</strong></div></div>${due.filter(a=>gcWinnerId(a)===String(accountDiscordId())).map(a=>`<div class="gc-payment-item"><span>${gcEsc(a.name)}</span><button class="btn btn-green" onclick="gsPay('${a.id}')">Pay ${gcMoney(a.currentBid)}</button></div>`).join('')}<div class="uniform-actions"><button class="btn btn-outline" onclick="gsForm('deposit')">Add funds</button><button class="btn btn-outline" onclick="openUserSettings()">Account</button></div></div>`;};
gsPayoutQueue=function(raiders,calc){return `<div class="settlement-section" id="payout-queue"><div class="settlement-section-title">Raider payouts</div>${raiders.map(r=>{const cut=Number(r.gsCut??calc.cuts[r.key]??0),credited=Number(r.gsCredited||0),done=credited>=cut;return `<div class="gs-payout-row"><div class="gc-row-person"><strong>${gcEsc(r.name)}</strong><span class="gc-amount-small">${payoutDisplayAmount(r,cut)}</span> <small>${done?'Paid':credited?payoutDisplayAmount(r,credited)+' paid':'Awaiting payout'}</small></div><div class="uniform-actions">${done?'<span class="gc-state">Paid</span>':`<button class="btn btn-green" ${!settlement.payoutStarted?'disabled':''} onclick="gsCredit('${r.key}')">${r.gsPayoutMethod==='gold'?'Record gold paid':'Pay '+gcMoney(cut-credited)}</button>`}<button class="btn btn-outline" ${!settlement.payoutStarted?'disabled':''} onclick="gsAdjust('${r.key}')">Adjust cut</button>${r.cutRequest?`<button class="btn btn-outline" onclick="openCutRequestReview('${r.key}')">Review request</button>`:''}</div></div>`;}).join('')}</div>`;};
// Suspend the underlying form while confirmation is active; cancellation restores it.
const gcOriginalConfirm=wowConfirm;
wowConfirm=function(options){const form=document.getElementById('gs-form'),previousFocus=document.activeElement;if(form)form.hidden=true;gcOriginalConfirm(options);const dialog=document.getElementById('wow-dialog-overlay');if(!dialog){if(form)form.hidden=false;return;}dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');let accepted=false;const confirm=document.getElementById('wow-confirm');confirm?.addEventListener('click',()=>{if(!options.input)accepted=true;},true);const observer=new MutationObserver(()=>{if(!dialog.isConnected){observer.disconnect();if(form?.isConnected)form.hidden=false;if(!accepted&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}});observer.observe(document.body,{childList:true});};
const fastActionPending=new Set();
gsAction=async function(op,data={},confirmText=''){
 if(gsBusy&&!['creditCut','payWin','refundWin'].includes(op))return;
 const perform=async()=>{const independent=['creditCut','payWin','refundWin'].includes(op),key=JSON.stringify([accountDiscordId(),op,data.runId,data.raiderKey,data.auctionId]);if((!independent&&gsBusy)||fastActionPending.has(key))return;fastActionPending.add(key);if(!independent)gsBusy=true;const y=window.scrollY,form=document.getElementById('gs-form');try{await gsCall(op,data);if(form?.isConnected)form.remove();if(document.querySelector('#gs-account-state,#gs-admin-queue,[data-gc-available]'))void gsRefresh();renderMain();window.scrollTo(0,y);toast(({withdraw:'Withdrawal requested',withdrawCancel:'Withdrawal cancelled',depositCancel:'Deposit request cancelled',payWin:'Payment complete',creditCut:'Payout complete',lockCuts:'Cuts locked',refundWin:'Purchase refunded'})[op]||'Saved');}catch(e){toast(e.message||'Could not complete the request.');}finally{fastActionPending.delete(key);if(!independent)gsBusy=false;}};
 if(!confirmText){await perform();return;}
 const withdrawal=op==='withdraw';
 const message=withdrawal?`<p>Request <strong>${Number(data.amount).toLocaleString()} USDC</strong> on Ethereum?</p><p class="gc-address">${gcEsc(data.address)}</p><p>${gcMoney(data.amount)} will be held until this request is completed or cancelled.</p><p>Available after request: <strong>${gcMoney(Number(gsSnapshot?.account?.gsBalance||0)-Number(data.amount))}</strong></p>`:gcEsc(confirmText.replaceAll('GS','GC'));
 wowConfirm({title:withdrawal?'Request withdrawal':op==='payWin'?'Confirm payment':op==='creditCut'?'Pay raid cut':op==='withdrawCancel'?'Cancel withdrawal':'Confirm action',msg:message,confirmLabel:withdrawal?'Request withdrawal':op==='payWin'?'Pay now':op==='creditCut'?'Pay cut':'Confirm',onConfirm:perform});
};window.gsAction=gsAction;
const gcFormOriginal=gsForm;
gsForm=function(type){gcFormOriginal(type);const el=document.getElementById('gs-form');if(!el)return;el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');const title=el.querySelector('.settlement-section-title');if(title)title.textContent=({deposit:'Add funds with USDC',withdraw:'Withdraw to your wallet',configure:'Treasury wallet',float:'Transfer treasury funds'})[type]||title.textContent;el.querySelectorAll('label').forEach(label=>{for(const node of label.childNodes)if(node.nodeType===3)node.textContent=node.textContent.replaceAll('GS','GC');});if(type==='withdraw'){const hint=document.createElement('p');hint.className='settlement-muted';hint.textContent='Available: '+gcAvailable()+'. Use an Ethereum wallet address.';title?.after(hint);}el.querySelector('input')?.focus();};window.gsForm=gsForm;
const gcOriginalRenderMain=renderMain;
renderMain=function(...args){const y=window.scrollY;const result=gcOriginalRenderMain(...args);if(document.getElementById('payout-queue'))window.scrollTo(0,y);return result;};
// Refresh balances while the purchase summary is visible without rebuilding that summary.
// Account and menu balances share the visibility-aware account polling timer.
setAutoBid=function(id){const a=auctions[id];if(!a||a.status!=='open')return;const bids=Object.values(a.bids||{}).filter(b=>!b.retracted),step=a.minIncrement||(gsContext()?1:250),min=Number(a.currentBid||0)+(bids.length?step:0);wowConfirm({title:'Auto bid',msg:gcEsc(a.name)+'<p>Counterbid by the minimum increment up to your limit. Keep this tab open for auto bidding.</p><p>Minimum: '+gcEsc(displayMoney(min))+'</p>',confirmLabel:'Set auto bid',input:{min,step,value:min,placeholder:'Maximum bid',errorMsg:'Enter at least '+displayMoney(min)},onConfirm:max=>{autoBids[id]=max;toast('Auto bid set to '+displayMoney(max));render();}});};window.setAutoBid=setAutoBid;

const gcLaunchAudio=new Audio("data:audio/wav;base64,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UP9w/5X/vP/l/w4AOABgAIYAqADHAOAA8wACAQoBDQEMAQUB+gDsANwAyQC0AJ4AiABxAFoAQgAqABIA+//j/8r/sf+Y/3//Z/9Q/zr/Jv8V/wf//f73/vX++P4B/w7/IP83/1P/cv+V/7v/4v8JADEAWAB9AJ8AvQDXAOwA/AAGAQwBDAEHAf0A8ADfAMwAtgCgAIgAcABYAEAAKAARAPv/5P/M/7X/nv+G/2//WP9C/y7/HP8N/wH/+f71/vf+/v4L/x3/NP9Q/3D/lP+6/+H/CAAwAFYAegCbALgA0QDlAPQA/wAEAQUBAQH5AO4A3wDOALoApACNAHYAXQBFACwAEwD8/+T/zP+0/53/hv9w/1v/Rv80/yP/FP8I/wD//P79/gL/Df8d/zL/TP9q/43/sv/a/wEAKgBRAHYAmAC2ANAA5ADzAP0AAgECAf4A9QDpANsAyQC2AKIAjQB3AGAASQAxABoAAgDr/9L/uv+i/4r/cv9c/0f/NP8j/xX/Cv8D/wD/Af8H/xL/If82/07/a/+M/6//1f/8/yIASABtAI8ArgDJAN8A8AD7AAIBAwH/APcA6wDcAMoAtgChAIsAdABeAEcAMAAaAAMA7f/X/8D/qf+R/3r/ZP9O/zr/KP8Y/wz/A////gD/Bf8Q/yD/Nf9O/2v/jP+w/9X/+/8gAEUAaQCKAKcAwQDXAOcA9AD7AP4A/AD1AOsA3gDNALoApgCQAHkAYQBJADIAGgADAO3/1v+//6n/k/99/2j/VP9B/y//IP8T/wr/Bf8E/wf/EP8e/zH/Sf9m/4b/qv/P//b/HABCAGcAiACmAL8A1QDlAPAA9wD5APYA8ADmANkAygC5AKUAkQB7AGUATgA3ACAACQDy/9r/w/+r/5T/fv9p/1T/Qf8x/yL/F/8O/wr/Cf8N/xX/I/80/0v/Zf+E/6X/yf/v/xQAOgBeAIAAnwC7ANEA4wDwAPcA+gD3APEA5gDZAMkAtwCjAI4AeQBjAE4AOAAiAAwA9v/g/8n/sv+c/4X/b/9Z/0X/M/8k/xf/Dv8J/wn/Df8W/yP/Nv9M/2f/hf+m/8n/7f8RADUAWAB5AJcAsgDJANsA6QDyAPYA9QDxAOgA2wDMALoApgCRAHsAZQBOADcAIQALAPb/4P/K/7T/n/+K/3X/YP9N/zv/K/8e/xT/Df8L/w3/Ff8h/zL/SP9j/4H/ov/G/+v/DwA0AFcAeACVAK8AxQDXAOQA7ADwAO8A6wDjANgAygC6AKgAlAB/AGkAUwA9ACYADwD5/+L/y/+1/5//iv91/2H/T/8+/y//I/8a/xP/Ef8T/xn/JP80/0j/Yf99/53/v//j/wgALABQAHIAkQCsAMMA1gDjAOwA8ADvAOoA4QDWAMcAtwClAJEAfQBpAFQAPgApABMA/v/o/9L/u/+l/4//ef9k/1H/P/8w/yP/Gv8U/xL/Ff8c/yf/N/9L/2P/f/+d/77/4f8DACcASQBqAIkApAC8AM8A3gDoAO4A7gDrAOMA2ADKALkApwCTAH4AaABTAD0AKAASAP7/6f/U/7//qv+V/4D/a/9Y/0b/Nv8o/x3/Fv8T/xT/Gv8l/zT/SP9h/33/nP+9/+D/AgAlAEgAaACFAKAAtgDJANcA4QDnAOkA5gDgANYAygC6AKkAlgCCAG0AVwBBACsAFQAAAOr/1P+//6r/lf+B/27/XP9L/zv/Lv8k/x3/Gf8Z/x7/J/80/0f/Xf94/5b/t//Z//3/IABDAGQAgwCeALUAyADWAOAA5QDmAOMA3ADSAMYAtwCmAJQAgQBuAFkARAAvABoABADv/9r/xP+u/5j/g/9v/13/S/88/y//Jf8f/xz/Hf8h/yv/OP9K/1//ef+V/7T/1f/4/xkAOwBcAHsAlwCvAMMA0wDeAOUA5wDkAN4A1ADHALgApwCUAIAAbABYAEMALgAaAAUA8v/d/8j/tP+f/4r/dv9j/1H/QP8y/yf/IP8c/xz/IP8p/zf/Sf9f/3n/lf+0/9X/9/8YADkAWAB2AJEAqAC8AMwA1wDfAOIA4QDcANQAyAC6AKoAlwCEAHAAWwBFADAAGwAGAPL/3f/I/7T/oP+N/3r/Z/9W/0f/Of8u/yX/IP8f/yL/Kv82/0b/W/90/5D/r//Q//P/FAA2AFYAdACPAKcAugDJANQA2wDeANwA1wDPAMQAtwCoAJcAhQByAF4ASgA1ACAACgD2/+H/zP+3/6L/jv96/2j/V/9I/zv/Mf8p/yX/JP8n/y7/Ov9J/1z/dP+O/6z/y//s/w0ALwBPAG4AiQCiALcAxwDTANsA3gDdANgAzwDEALYApgCVAIMAcABcAEkANQAhAA0A+v/m/9H/vf+o/5T/gP9t/1v/S/89/zL/Kf8l/yT/J/8v/zr/Sv9e/3X/j/+s/8v/6/8LACsASgBoAIMAmwCwAMEAzQDWANoA2wDXANAAxgC5AKkAmACFAHIAXgBJADUAIQAMAPn/5v/S/77/q/+Y/4X/c/9h/1H/Q/83/y7/KP8m/yj/Lv84/0f/W/9x/4z/qf/I/+n/CQApAEkAZgCBAJgArAC9AMkA0QDVANYA0wDMAMMAtwCpAJkAiAB1AGIATgA5ACUAEAD8/+j/0/+//6v/mP+F/3T/Y/9U/0f/PP8z/y3/K/8t/zL/O/9J/1r/cP+J/6X/w//j/wIAIwBDAGEAfQCVAKoAuwDIANEA1QDVANIAywDBALUApgCWAIUAdABhAE4AOwAoABQAAADt/9n/xf+w/53/if93/2X/Vf9I/zz/NP8u/yz/Lv80/z7/S/9d/3L/iv+l/8L/4P8AAB4APQBaAHYAjgCkALYAwwDNANMA1ADSAMwAwwC3AKgAmACGAHQAYQBOADoAJwATAAAA7v/b/8j/tf+i/4//ff9r/1v/Tf9A/zf/MP8t/y7/M/88/0n/W/9w/4j/o//A/9///v8dADsAWABzAIsAnwCwAL4AyADNAM8AzgDJAMEAtgCpAJoAiQB3AGUAUQA9ACoAFgACAO//2//I/7X/ov+Q/3//bv9f/1H/Rv88/zb/Mv8y/zb/Pv9K/1n/bf+E/5//u//a//n/GAA3AFUAcACIAJ4ArwC9AMYAzADNAMsAxgC+ALMApgCYAIgAdwBlAFMAQAAtABoABgD0/+D/zP+5/6X/kv+A/3D/YP9S/0f/Pv84/zX/Nf85/0H/Tf9c/2//hf+e/7n/1v/1/xIAMQBOAGkAggCYAKsAuQDEAMsAzQDMAMcAvwC0AKcAmACHAHYAZABSAD8ALQAaAAcA9v/j/9D/vf+r/5j/hv91/2X/Vv9K/0D/Of81/zX/OP9A/0z/W/9u/4X/nv+5/9b/9P8RAC4ASwBlAH0AkwClALMAvgDFAMkAyQDFAL4AtACoAJoAigB5AGcAVABBAC4AGwAIAPb/4//Q/77/rP+a/4n/ef9q/1z/T/9F/z7/Of84/zr/Qf9L/1n/bP+B/5r/tf/S//D/DgArAEgAYwB8AJEAowCxALwAwgDFAMUAwQC7ALEApgCZAIoAegBpAFcARQAyAB8ADAD6/+f/0//A/67/nP+K/3r/a/9d/1H/SP9B/z3/PP8+/0T/Tv9c/23/gf+Y/7L/zv/r/wgAJQBCAF0AdwCNAKAArwC6AMIAxQDFAMEAugCxAKUAlwCIAHgAZwBWAEQAMgAgAA4A/f/q/9j/xf+z/6H/j/9+/27/YP9T/0n/Qf89/zz/P/9F/0//XP9t/4L/mf+y/83/6v8FACIAPgBYAHEAhwCaAKkAtQC9AMIAwwDAALsAsgCnAJoAiwB6AGkAVwBFADMAIAAOAP3/6//Z/8f/tf+k/5P/g/9z/2X/WP9O/0b/QP8+/z//Rf9O/1r/a/9//5b/r//L/+f/AwAgADwAVwBvAIQAlwCmALEAuQC+AL8AvQC3ALAApQCZAIsAfABsAFoASAA2ACQAEQD//+3/2v/I/7b/pf+U/4T/df9n/1v/Uf9K/0X/Qv9D/0j/UP9c/2v/fv+T/6z/xv/i////GwA3AFIAawCBAJQApACwALkAvQC+ALwAtgCuAKMAlwCJAHoAagBaAEkAOAAmABQAAgDx/9//zf+7/6n/l/+H/3f/af9d/1L/Sv9F/0P/Rf9K/1L/Xv9t/3//lP+s/8X/4P/8/xcAMgBMAGUAewCPAJ8ArAC1ALsAvQC7ALcArwClAJkAiwB7AGsAWgBJADcAJQAUAAIA8v/h/8//vv+t/5z/jP98/27/Yf9W/03/R/9F/0X/Sf9R/1z/a/99/5P/qv/E/9//+/8VADEASgBiAHgAiwCbAKcAsAC2ALkAuAC0AK0ApACZAIwAfQBuAF0ATAA6ACgAFgAEAPP/4f/Q/7//rv+e/47/f/9x/2X/W/9S/0z/Sf9J/0z/Uv9d/2r/e/+Q/6f/wP/b//b/EQAtAEcAYAB2AIkAmQCmAK8AtQC3ALYAsgCrAKIAlwCKAHwAbQBdAE0APAArABoACAD3/+X/1P/C/7H/oP+Q/4D/cv9m/1z/U/9O/0v/S/9O/1X/X/9s/33/kP+m/77/2P/y/w0AJwBBAFoAcACEAJUAowCtALMAtgC2ALIAqwCiAJcAigB8AG0AXQBMADsAKwAaAAkA+f/o/9f/xv+1/6X/lP+F/3f/av9e/1X/T/9L/0v/Tv9U/17/bP98/5D/pv++/9f/8f8LACUAPwBWAGwAgACQAJ4AqACvALMAswCwAKsAowCYAIwAfgBvAF8ATgA9ACwAGwAJAPn/6P/X/8f/t/+n/5f/iP97/27/Y/9a/1P/T/9O/1D/Vf9e/2r/ev+N/6L/uv/U/+7/CAAjADwAVQBrAH4AjgCcAKYArACwALAArQCoAKAAlgCLAH4AbwBgAFAAQAAvAB4ADQD9/+v/2v/J/7j/qP+Y/4r/fP9w/2X/XP9W/1L/Uf9T/1j/Yf9s/3v/jf+h/7j/0P/q/wMAHgA3AFAAZgB6AIsAmQCkAKsArwCwAK0AqACgAJUAigB8AG4AXwBQAEAAMAAfAA8A///v/97/zf+9/6z/nP+N/3//cv9n/17/V/9T/1H/U/9Z/2H/bf98/43/ov+4/9D/6f8BABsANABLAGEAdQCGAJQAoACoAKwArgCsAKcAoACXAIsAfgBwAGEAUQBBADAAHwAPAP//7//f/8//v/+v/6D/kf+D/3f/a/9i/1r/Vf9T/1T/Wf9g/2v/ev+L/5//tf/N/+f/AAAZADIASQBfAHMAhACRAJwApACpAKoAqQClAJ4AlQCLAH8AcQBjAFMAQwAzACIAEgABAPH/4P/Q/8D/sP+h/5P/hf95/27/Zf9e/1n/V/9Y/1z/Y/9t/3r/iv+d/7L/yv/i//z/FAAuAEYAXABwAIEAkACbAKMAqACpAKgAowCdAJQAiQB9AHAAYgBTAEQANAAkABQABAD1/+T/1P/E/7T/pP+V/4f/ev9v/2b/X/9a/1j/Wf9d/2T/bv97/4v/nv+y/8n/4f/5/xEAKQBBAFcAawB8AIsAlwCgAKYAqACnAKQAnQCVAIoAfgBxAGIAUwBEADQAJAAUAAQA9v/m/9b/x/+3/6j/mf+M/3//c/9p/2H/XP9Z/1n/Xf9j/23/ev+K/5z/sf/I/9//+P8QACgAPwBUAGgAeQCIAJMAnACiAKQApAChAJwAlACKAH8AcgBkAFYARgA2ACYAFgAGAPf/5//X/8f/uP+p/5v/jv+C/3f/bf9l/2D/Xf9d/1//Zf9u/3n/iP+a/67/xP/c//T/DAAkADwAUgBmAHcAhgCSAJsAoACjAKIAnwCaAJIAiQB9AHEAZABWAEcAOAApABkACQD6/+r/2v/K/7v/q/+d/4//g/94/27/Z/9h/1//X/9h/2f/cP97/4n/mv+u/8P/2f/x/wgAIAA3AE0AYQBzAIIAjwCYAJ8AogCiAJ8AmgCSAIkAfgBxAGQAVQBHADgAKQAZAAoA/P/s/93/zv+//7D/of+T/4b/e/9x/2n/Y/9f/1//Yf9n/2//e/+J/5r/rf/C/9n/8P8GAB4ANABKAF0AbwB+AIsAlACbAJ8AoACeAJkAkgCKAH8AcwBmAFcASQA5ACoAGgALAPz/7f/e/8//wP+x/6T/lv+K/3//df9t/2b/Y/9h/2P/Z/9v/3r/h/+Y/6v/v//W/+3/BAAbADIASABcAG0AfACJAJIAmQCcAJ0AmwCXAJAAiAB+AHIAZgBYAEoAPAAtAB0ADgD///D/4P/R/8H/s/+l/5f/i/+A/3b/b/9p/2X/ZP9m/2r/cf97/4j/mP+p/73/0//p/wAAFwAuAEQAWABqAHoAhwCRAJgAnACdAJsAlgCQAIcAfQBxAGUAWABKADsALQAeAA8AAADy/+P/1P/F/7f/qP+b/47/gv94/3D/av9m/2X/Zv9q/3L/fP+J/5j/qv+9/9L/6P///xUAKwBAAFQAZQB1AIIAjQCUAJkAmwCaAJYAkACIAH4AcwBmAFkASwA8AC0AHgAQAAEA8//k/9b/x/+5/6v/nv+S/4b/fP90/23/aP9m/2f/a/9x/3v/h/+W/6j/u//Q/+b//f8TACkAPgBSAGMAcwCAAIoAkQCWAJgAlwCUAI4AhwB+AHMAZwBaAE0APwAwACEAEgADAPX/5v/X/8j/uv+s/5//k/+I/37/dv9w/2z/av9q/23/c/98/4f/lf+m/7n/zf/j//n/DwAlADsATwBhAHEAfgCIAJAAlQCXAJYAkwCNAIUAfAByAGYAWgBNAD8AMQAjABQABgD4/+n/2v/M/73/r/+i/5X/iv+A/3f/cf9s/2r/a/9u/3T/ff+I/5b/p/+5/8z/4f/3/wwAIgA3AEoAXABsAHoAhQCNAJMAlQCVAJMAjQCGAH0AcwBnAFoATQA/ADEAIwAUAAYA+f/q/9z/zv/A/7P/pv+Z/47/g/96/3P/bv9s/2z/bv90/3z/h/+V/6X/t//L/+D/9v8LACAANQBIAFoAaQB3AIIAigCPAJIAkwCQAIwAhQB9AHMAaABcAE8AQQAzACUAFgAHAPr/6//d/8//wf+0/6f/m/+Q/4b/fv93/3L/b/9u/3D/df99/4f/lP+j/7X/yP/d//P/BwAdADIARgBYAGgAdQCAAIgAjgCRAJEAjwCKAIQAfAByAGcAXABPAEIANAAnABgACgD9/+7/4P/S/8P/tv+p/53/kf+H/3//eP9z/3D/cP9y/3f/f/+J/5X/pP+1/8f/2//w/wQAGQAuAEIAVABkAHIAfgCGAI0AkACQAI8AigCEAHwAcgBnAFsATwBCADQAJwAZAAsA/v/w/+L/1P/H/7n/rP+g/5T/iv+B/3r/dP9x/3D/cv93/37/iP+V/6P/tP/H/9r/7/8DABgALAA/AFEAYABuAHoAgwCJAI0AjgCNAIkAhAB8AHMAaQBdAFAAQwA2ACgAGgAMAP//8f/j/9X/yP+7/6//o/+X/43/hP99/3j/dP9z/3T/eP9+/4f/k/+i/7L/xP/Y/+z/AAAVACoAPQBPAF8AbQB4AIEAhwCLAIwAiwCHAIIAewByAGgAXQBRAEUANwAqABwADgAAAPP/5f/X/8r/vP+w/6T/mf+P/4b/f/96/3b/df92/3r/gP+J/5T/of+x/8P/1f/p//7/EgAmADkASwBcAGoAdgB/AIYAigCLAIoAhwCBAHoAcQBnAFwAUQBEADcAKgAdABAAAgD1/+j/2v/N/8D/s/+n/5v/kf+I/4D/e/93/3b/d/96/4D/if+U/6L/sf/C/9X/6P/8/w8AIwA2AEgAWABmAHIAfACDAIgAigCJAIYAggB7AHIAaABdAFIARQA4ACsAHQAQAAIA9v/p/9z/z//C/7X/qv+e/5T/i/+D/33/ef93/3j/e/+A/4j/k/+g/7D/wf/T/+f/+/8OACIANQBGAFYAZABwAHkAgACFAIcAhwCEAIAAegByAGgAXgBTAEcAOgAtACAAEgAEAPj/6v/d/9D/w/+3/6v/oP+W/43/hv+A/3z/ev96/33/gv+J/5P/oP+u/7//0f/k//f/CgAeADEAQwBUAGIAbgB4AH8AhACGAIYAgwB/AHgAcQBnAF0AUgBHADoALgAhABQABwD6/+3/4P/T/8b/uf+t/6L/l/+O/4f/gf99/3v/e/9+/4P/iv+U/6D/r/++/9D/4v/2/wgAGwAuAEAAUABeAGsAdQB9AIIAhQCFAIMAfwB5AHEAaABeAFMARwA6AC4AIQAUAAcA+//u/+H/1f/I/7z/sP+l/5v/kf+J/4P/fv98/3z/fv+D/4r/lP+f/67/vf/P/+H/9P8HABoALAA+AE4AXABoAHIAegB/AIIAgwCBAH4AeABxAGkAXwBUAEgAPAAwACMAFgAIAPz/7//i/9b/yf+9/7L/p/+d/5T/jP+G/4H/f/9+/4D/hP+K/5P/n/+s/7v/zP/f//L/BAAXACoAOwBMAFoAZgBxAHgAfgCBAIEAgAB8AHcAcABnAF4AVABJAD0AMQAkABgACwD///L/5f/Y/8v/v/+z/6j/nv+V/43/h/+D/4D/gP+B/4b/jP+V/5//rP+7/8v/3f/v/wEAFAAmADgASABXAGQAbgB2AHwAgACBAH8AfAB3AHAAZwBeAFQASAA9ADEAJAAYAAwAAADz/+f/2v/O/8L/tv+r/6H/mP+P/4n/hP+B/4D/gv+F/4z/lP+f/6z/u//L/9z/7v8AABIAJAA1AEUAVABgAGsAcwB5AH0AfwB+AHsAdgBwAGgAXwBVAEoAPgAyACYAGQAMAAAA9P/o/9v/z//E/7j/rf+j/5r/kv+M/4f/g/+C/4P/hv+M/5T/nv+q/7n/yf/a/+z///8QACIANABEAFIAXwBpAHEAdwB7AH0AfAB5AHUAbwBnAF8AVQBKAD8AMwAnABsADwACAPb/6v/d/9H/xf+5/6//pf+c/5T/jf+I/4X/hP+F/4j/jf+V/5//qv+4/8f/2P/q//z/DQAfADAAQQBPAFwAZwBwAHYAegB8AHsAeQB0AG4AZwBeAFQASgA/ADMAKAAcABAAAwD4/+z/4P/U/8j/vP+x/6f/nv+V/4//if+G/4X/hv+J/47/lf+f/6v/uP/H/9j/6f/6/wsAHQAuAD4ATABZAGQAbQB0AHgAegB6AHgAdABvAGcAXwBVAEsAQAA0ACgAHAAQAAQA+f/t/+H/1f/K/77/tP+q/6H/mP+R/4z/iP+G/4f/if+O/5X/nv+p/7f/xv/W/+f/+f8KABsALAA8AEoAVwBiAGsAcQB2AHgAeAB2AHMAbgBnAF8AVgBMAEEANgAqAB4AEgAGAPr/7v/i/9b/y/+//7X/q/+i/5r/k/+O/4r/if+J/4v/j/+W/57/qf+2/8T/1P/l//b/BwAYACkAOQBIAFUAYABpAHAAdQB3AHcAdgByAG0AZgBeAFUASwBBADYAKwAfABMACAD9//H/5f/Z/83/wv+3/63/pP+b/5T/j/+L/4n/iv+M/5D/l/+f/6r/tv/E/9P/4//0/wUAFgAmADYARQBSAF0AZwBuAHMAdgB3AHUAcgBtAGYAXgBVAEwAQQA2ACsAHwAUAAgA/f/y/+b/2//P/8T/uv+w/6b/nv+X/5H/jf+L/4r/jP+Q/5b/nv+p/7X/w//S/+L/8/8DABQAJQA1AEMAUABbAGQAawBwAHQAdQB0AHEAbABmAF8AVgBNAEIAOAAsACEAFQAJAP7/8//n/9v/0P/F/7v/sf+o/6D/mf+U/4//jf+M/47/kf+X/57/qP+0/8H/0P/g//H/AQASACMAMwBBAE4AWQBjAGoAbwByAHMAcgBvAGsAZQBeAFYATABDADgALQAiABcACwAAAPX/6f/d/9L/x/+9/7P/qf+h/5r/lf+R/47/jv+P/5L/mP+f/6n/tP/B/8//3//v/wAADwAgAC8APgBLAFcAYQBoAG4AcQBzAHIAbwBrAGUAXgBVAEwAQgA4AC0AIgAXAAwAAQD2/+v/4P/V/8r/v/+1/6z/pP+c/5b/kv+P/47/j/+S/5j/n/+p/7T/wf/P/97/7v///w4AHgAtADwASQBUAF4AZgBrAG8AcQBwAG4AagBlAF4AVgBNAEQAOQAuACMAGAANAAEA9//s/+D/1v/L/8H/t/+u/6b/n/+Z/5T/kf+Q/5H/k/+Y/5//qP+z/7//zf/c/+z//f8MABwALAA6AEcAUwBcAGQAagBtAG8AbwBtAGkAZABdAFYATQBEADoAMAAlABoADwADAPn/7f/i/9f/zP/C/7j/r/+n/6D/mv+W/5P/kv+S/5X/mf+g/6j/s/+//8z/2//q//r/CQAZACkANwBFAFAAWgBiAGgAbABuAG4AbABpAGMAXQBVAE0ARAA6ADAAJQAaABAABQD6/+//5P/Z/8//xP+7/7H/qf+i/5v/l/+U/5L/k/+V/5r/oP+p/7P/v//M/9r/6f/5/wgAFwAnADUAQgBOAFgAYABmAGoAbQBtAGwAaABkAF0AVgBOAEQAOwAwACYAGwAQAAUA+//w/+X/2//Q/8b/vf+0/6v/pP+e/5n/lf+U/5T/lv+a/6D/qP+y/73/yv/Z/+j/+P8GABYAJQAzAEAATABWAF4AZABoAGsAawBqAGcAYwBdAFYATgBFADwAMgAnAB0AEgAHAPz/8f/n/9z/0f/H/77/tf+t/6b/oP+b/5f/lv+W/5f/m/+h/6j/sv+9/8n/1//m//X/BAAUACMAMQA+AEoAVABdAGMAZwBqAGoAaQBmAGIAXABVAE0ARQA8ADIAKAAdABMACAD+//T/6f/e/9T/yf/A/7f/rv+n/6H/nP+Y/5b/lv+Y/5z/of+p/7L/vf/J/9b/5f/0/wIAEQAgAC4AOwBHAFIAWgBhAGYAaQBqAGkAZgBiAFwAVgBOAEUAPAAyACgAHgATAAkA///0/+r/4P/V/8z/wv+5/7H/qf+j/57/mv+Y/5f/mP+c/6H/qP+x/7z/yP/W/+T/8/8BABAAHwAtADoARQBPAFgAXwBkAGcAaABnAGUAYQBcAFYATgBGAD0AMwApAB8AFAAKAAAA9f/r/+H/1v/N/8P/u/+y/6v/pf+g/5z/mv+Z/5r/nf+i/6j/sf+7/8f/1P/i//H/AAAOAB0AKwA4AEQATgBXAF0AYgBlAGcAZgBkAGAAWwBVAE4ARgA9ADQAKgAgABYACwABAPf/7f/i/9j/zv/F/7z/tP+s/6b/of+d/5v/mv+b/57/o/+p/7H/u//H/9P/4f/v//7/DAAaACgANQBBAEwAVQBcAGEAZABmAGYAZABgAFsAVQBOAEYAPQA0ACoAIAAWAAwAAgD5/+7/5P/a/9D/x/++/7b/rv+o/6L/nv+c/5v/m/+e/6P/qf+x/7v/xv/T/+D/7v/9/woAGQAmADMAPwBJAFIAWQBfAGIAZABkAGMAYABbAFUATgBGAD4ANQArACEAFwANAAMA+f/v/+X/2//S/8j/wP+4/7D/qv+k/6D/nf+c/53/n/+j/6n/sf+6/8X/0f/e/+3/+/8JABcAJQAyAD4ASABRAFgAXQBhAGMAYwBhAF4AWgBUAE4ARgA+ADUALAAiABkADgAEAPv/8f/m/93/0//K/8H/uf+x/6v/pv+i/5//nv+e/6D/pP+q/7H/uv/E/9D/3f/r/w==");gcLaunchAudio.preload='auto';gcLaunchAudio.volume=.22;let gcLastLaunch=0;playGoLiveSound=function(count){if(soundMuted||!count||Date.now()-gcLastLaunch<250)return;gcLastLaunch=Date.now();clearTimeout(notificationSoundTimer);gcLaunchAudio.currentTime=0;gcLaunchAudio.play().catch(()=>{});};

// Godspeed speaker icon v1.
const gcSpeakerPreviousHeader=renderHdr;
renderHdr=function(){gcSpeakerPreviousHeader();const button=document.querySelector('#hdr-user .header-state-button');if(!button)return;const muted=!!soundMuted;button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>'+(muted?'<path d="m16 9 5 6m0-6-5 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>')+'</svg>';button.setAttribute('aria-label',muted?'Sound muted. Turn sound on':'Sound on. Mute sound');button.setAttribute('title',muted?'Turn sound on':'Mute sound');button.setAttribute('aria-pressed',String(!muted));};

// Godspeed personal settings, 2026-09-14. Display preferences only.
const gpDefaults={soundActivity:true,soundTabs:true,fantasyCursor:true,text:'standard',volume:50,muted:false,soundBid:true,soundStart:true,soundEnding:true,soundOutbid:true,soundWon:true,alertOutbid:true,alertWon:true,alertEnding:true,motion:false,density:'comfortable',tooltips:'hover',landing:'active',timeZone:'local',clock:'12'};
let gpOwner='',gp={...gpDefaults},gpLandingOwner='',gpAudioContext=null;
function gpKey(){return 'gdkp_preferences_v1:'+String(discordUser?.id||user||'guest');}
function gpLoad(){const key=gpKey();if(key===gpOwner)return;gpOwner=key;let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}gp={...gpDefaults,...saved};if(gp.cursorStyleVersion!==1){gp.fantasyCursor=true;gp.cursorStyleVersion=1;gpStore();}gp.volume=Math.max(0,Math.min(100,Number(gp.volume)||0));gpApply();}
function gpStore(){try{localStorage.setItem(gpOwner,JSON.stringify(gp));}catch{toast('Your browser could not save preferences.');}}
function gpApply(){document.documentElement.classList.toggle('fantasy-cursor',!!gp.fantasyCursor);gcSetText(gp.text);document.documentElement.dataset.gpMotion=gp.motion?'reduced':'full';document.documentElement.dataset.gpDensity=gp.density;soundMuted=!!gp.muted;if(soundMuted){if(typeof notificationSoundTimer!=='undefined')clearTimeout(notificationSoundTimer);activeNotificationAudio?.pause?.();gcLaunchAudio.pause?.();}localStorage.setItem('gdkp_muted',soundMuted?'1':'0');if(activeNotificationAudio)activeNotificationAudio.volume=.07*gp.volume/100;gcLaunchAudio.volume=.44*gp.volume/100;}
function gpSet(key,value){if(!(key in gpDefaults))return;gp[key]=typeof gpDefaults[key]==='boolean'?!!value:typeof gpDefaults[key]==='number'?Number(value):value;gp.volume=Math.max(0,Math.min(100,gp.volume));gpStore();gpApply();const out=document.getElementById('gp-volume-value');if(out)out.textContent=gp.volume+'%';if(['timeZone','clock'].includes(key)){const el=document.getElementById('gp-time-preview');if(el)el.textContent=gpDate(Date.now());}if(key==='tooltips')gpHideTooltip();}
function gpDate(ts){if(!ts)return '';return new Date(ts).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:gp.clock!=='24',...(gp.timeZone==='server'?{timeZone:'America/New_York'}:{})});}
accountDate=gpDate;
function gpTone(kind='test',test=false){if(!test&&(gp.muted||!gp['sound'+kind[0].toUpperCase()+kind.slice(1)]))return;if(!gp.volume)return;try{gpAudioContext??=new(window.AudioContext||window.webkitAudioContext)();const ctx=gpAudioContext;ctx.resume().catch(()=>{});const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;osc.connect(gain);gain.connect(ctx.destination);osc.frequency.setValueAtTime(({ending:720,outbid:440,won:880,test:660})[kind]||660,t);gain.gain.setValueAtTime(.12*gp.volume/100,t);gain.gain.exponentialRampToValueAtTime(.001,t+.22);osc.start(t);osc.stop(t+.24);}catch{toast('Sound is unavailable in this browser.');}}
const gpAlertSeen=new Set();
function gpNotify(kind,a){const k=runId+':'+kind+':'+a.id+':'+(kind==='outbid'?Object.keys(a.bids||{}).length:kind==='ending'?a.endsAt:'sold');if(gpAlertSeen.has(k))return;gpAlertSeen.add(k);if(gpAlertSeen.size>1000)gpAlertSeen.delete(gpAlertSeen.values().next().value);if(gp['alert'+kind[0].toUpperCase()+kind.slice(1)])toast(({ending:'Ending in 10 seconds: ',outbid:'You were outbid: ',won:'You won: '})[kind]+a.name);gpTone(kind);}
window.gsPrefsNotify=gpNotify;
const gpCoinOriginal=playCoinSound;
playCoinSound=function(...args){if(!gp.soundBid)return;const result=gpCoinOriginal(...args);if(activeNotificationAudio)activeNotificationAudio.volume=.07*gp.volume/100;return result;};
const gpLiveOriginal=playGoLiveSound;
playGoLiveSound=function(...args){if(!gp.soundStart)return;gcLaunchAudio.volume=.44*gp.volume/100;return gpLiveOriginal(...args);};
const gpMuteOriginal=toggleMute;
toggleMute=function(){gp.muted=!soundMuted;gpStore();gpApply();renderHdr();toast(gp.muted?'Sound muted':'Sound on');};
const gpSpawnOriginal=spawnCoin;spawnCoin=function(...args){if(!gp.motion)return gpSpawnOriginal(...args);};
const gpExplosionOriginal=coinExplosionAt;coinExplosionAt=function(...args){if(!gp.motion)return gpExplosionOriginal(...args);};
function gpOptions(values,current){return values.map(([value,label])=>`<option value="${value}" ${String(current)===String(value)?'selected':''}>${settlementEsc(label)}</option>`).join('');}
function gpSelect(key,label,values){return `<label class="gp-row" for="gp-${key}"><span>${label}</span><select id="gp-${key}" onchange="gpSet('${key}',this.value)">${gpOptions(values,gp[key])}</select></label>`;}
function gpCheck(key,label){return `<label class="gp-row" for="gp-${key}"><span>${label}</span><input id="gp-${key}" type="checkbox" ${gp[key]?'checked':''} onchange="gpSet('${key}',this.checked)"></label>`;}
function gpCloseSettings(){document.getElementById('gp-settings')?.remove();}
function gpRestorePrompts(){Object.keys(_suppressedDialogs).forEach(k=>delete _suppressedDialogs[k]);_saveSuppress();toast('Confirmations restored');}
function gpReset(){wowConfirm({title:'Reset preferences',msg:'Restore your appearance, sound, alert, tooltip, time, and landing-tab preferences? Your saved characters and raid data stay as they are.',confirmLabel:'Reset preferences',onConfirm:()=>{gp={...gpDefaults};gpStore();gpApply();gpOpenSettings();renderHdr();toast('Preferences reset');}});}
function gpOpenSettings(){gpCloseMenu();closeUserSettings();gpCloseSettings();gpLoad();const ov=document.createElement('div');ov.id='gp-settings';ov.className='account-payment-overlay';ov.style.zIndex='220';ov.setAttribute('aria-label','Settings');ov.innerHTML=`<div class="account-payment-card gp-settings-card"><div class="gp-settings-head"><h2>Settings</h2><button class="btn btn-outline" onclick="gpCloseSettings()">Close</button></div><p class="settlement-muted">Changes save on this browser for your account.</p><fieldset><legend>Appearance</legend>${gpCheck('fantasyCursor','Fantasy gauntlet cursor')}${gpSelect('text','Text size',[['standard','Standard'],['large','Large'],['larger','Larger']])}${gpCheck('motion','Reduce animations and coin effects')}${gpSelect('density','Auction spacing',[['comfortable','Comfortable'],['compact','Compact']])}${gpSelect('tooltips','Item tooltips',[['hover','Show on hover'],['click','Show on click']])}<p class="settlement-muted">In click mode, click an item once for its tooltip and again to open its item page.</p></fieldset><fieldset><legend>Sound & Alerts</legend>${gpCheck('muted','Mute all sounds')}${gpCheck('soundTabs','Interface click sounds')}<label class="gp-row" for="gp-volume"><span>Volume <output id="gp-volume-value">${gp.volume}%</output></span><input id="gp-volume" type="range" min="0" max="100" value="${gp.volume}" oninput="gpSet('volume',this.value)"></label><button class="btn btn-outline" onclick="gpTone('test',true)">Test volume</button><p class="settlement-muted">The test plays at the selected volume, including while muted.</p>${gpCheck('soundBid','Your bid jingles')}${gpCheck('soundActivity','Raid activity jingles')}${gpCheck('soundStart','Auction start sounds')}${gpCheck('soundEnding','Ending-soon sound')}${gpCheck('soundOutbid','Outbid sound')}${gpCheck('soundWon','Item-won sound')}<h3>On-screen alerts</h3>${gpCheck('alertOutbid','When I am outbid')}${gpCheck('alertWon','When I win an item')}${gpCheck('alertEnding','Ending soon for items I bid on')}</fieldset><fieldset><legend>Preferences</legend><label class="gp-row" for="gp-character"><span>Default character</span><select id="gp-character" onchange="setPreferredCharacter(this.value)">${gpOptions([['','Choose a saved character'],...discordCharacters.map(n=>[n,n])],preferredCharacter())}</select></label><p class="settlement-muted">Manage saved characters in My Account.</p>${gpSelect('landing','Default landing tab',[['active','Live'],...(isRL?[['queued','Queue']]:[]),['payout','My Payout']])}${gpSelect('timeZone','Time zone',[['local','My local time'],['server','Server time (Eastern)']])}${gpSelect('clock','Clock format',[['12','12-hour'],['24','24-hour']])}<p id="gp-time-preview" class="settlement-muted">${gpDate(Date.now())}</p><button class="btn btn-outline" onclick="gpRestorePrompts()">Restore confirmation prompts</button>${isRL?'<p><button class="btn btn-outline" onclick="gpCloseSettings();openPanel();setPanelTab(\'raiders\')">Open Raid Tools</button></p>':''}</fieldset><button class="btn btn-outline" onclick="gpReset()">Reset preferences</button></div>`;ov.addEventListener('mousedown',e=>{if(e.target===ov)gpCloseSettings();});document.body.appendChild(ov);ov.querySelector('button').focus();}
function gpCloseMenu(){const menu=document.getElementById('gp-account-menu');if(menu){menu.remove();document.getElementById('gp-account-button')?.setAttribute('aria-expanded','false');}}
function gpMenuAction(action){gpCloseMenu();if(action==='account')openUserSettings();else if(action==='settings')gpOpenSettings();else logout();}
function gpToggleMenu(){if(document.getElementById('gp-account-menu')){gpCloseMenu();return;}const button=document.getElementById('gp-account-button');if(!button)return;const menu=document.createElement('div');menu.id='gp-account-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Account');menu.innerHTML=`<div class="gp-balance">Available GC<strong data-gc-available>${gcAvailable()}</strong></div><button role="menuitem" onclick="gpMenuAction('account')">My Account</button><button role="menuitem" onclick="gpMenuAction('settings')">Settings</button><button role="menuitem" onclick="gpMenuAction('logout')">Sign Out</button>`;document.body.appendChild(menu);const box=button.getBoundingClientRect();menu.style.top=Math.min(box.bottom+6,innerHeight-220)+'px';menu.style.right=Math.max(8,innerWidth-box.right)+'px';button.setAttribute('aria-expanded','true');menu.querySelector('button').focus();gsRefresh();}
const gpHeaderOriginal=renderHdr;
renderHdr=function(){gpLoad();const menuOpen=!!document.getElementById('gp-account-menu');gpHeaderOriginal();document.getElementById('gc-text-control')?.remove();const chip=document.querySelector('#hdr-user .usr-chip');if(chip){const b=document.createElement('button');b.id='gp-account-button';b.type='button';b.className='usr-chip';b.textContent=user+' ▾';b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded',String(menuOpen));b.onclick=gpToggleMenu;chip.replaceWith(b);}if(user&&gpLandingOwner!==gpOwner&&!archivedSettlementContext){gpLandingOwner=gpOwner;const target=gp.landing==='queued'&&!isRL?'active':gp.landing;if(['active','queued','payout'].includes(target))tab=target;}};
const gpAccountOriginal=openUserSettings;
openUserSettings=function(...args){gpCloseMenu();gpCloseSettings();const result=gpAccountOriginal(...args);const sound=document.getElementById('us-sound');if(sound){const section=sound.closest('.user-settings-sec');section.hidden=true;sound.checked=!gp.muted;const link=document.createElement('div');link.className='user-settings-sec';link.innerHTML='<button class="btn btn-outline" onclick="gpOpenSettings()">Settings</button>';section.after(link);}return result;};
const gpAccountSaveOriginal=saveUserSettings;saveUserSettings=function(...args){const sound=document.getElementById('us-sound');if(sound)sound.checked=!gp.muted;return gpAccountSaveOriginal(...args);};
window.addEventListener('keydown',e=>{const menu=document.getElementById('gp-account-menu');if(menu&&['Escape','ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape'){gpCloseMenu();document.getElementById('gp-account-button')?.focus();return;}const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length].focus();}else if(e.key==='Escape'&&uiTopDialog()?.id==='gp-settings'){e.preventDefault();e.stopImmediatePropagation();gpCloseSettings();}},true);
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#gp-account-menu,#gp-account-button'))gpCloseMenu();});
document.addEventListener('focusin',e=>{if(!e.target.closest('#gp-account-menu,#gp-account-button'))gpCloseMenu();});
window.addEventListener('resize',gpCloseMenu);window.addEventListener('scroll',gpCloseMenu);
// Hover uses the existing provider timing; click mode forwards the first click.
let gpTooltipLink=null,gpTooltipDispatch=false;
function gpHideTooltip(){if(gpTooltipLink?.isConnected){gpTooltipDispatch=true;gpTooltipLink.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));gpTooltipDispatch=false;}gpTooltipLink=null;}
function gpShowTooltip(link){if(!link.isConnected)return;gpTooltipLink=link;gpTooltipDispatch=true;link.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));gpTooltipDispatch=false;}
window.addEventListener('mouseover',e=>{if(gpTooltipDispatch)return;const link=e.target.closest?.('a[data-wowhead]');if(!link||link.contains(e.relatedTarget)||gp.tooltips==='hover')return;e.stopImmediatePropagation();gpHideTooltip();},true);
window.addEventListener('mouseout',e=>{if(gpTooltipDispatch)return;const link=e.target.closest?.('a[data-wowhead]');if(link&&!link.contains(e.relatedTarget)&&gp.tooltips==='hover')gpHideTooltip();},true);
window.addEventListener('click',e=>{const link=e.target.closest?.('a[data-wowhead]');if(gp.tooltips==='click'&&link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){if(gpTooltipLink===link){gpHideTooltip();return;}e.preventDefault();e.stopImmediatePropagation();gpHideTooltip();gpShowTooltip(link);}else if(!e.target.closest?.('.wowhead-tooltip'))gpHideTooltip();},true);
Object.assign(window,{gpSet,gpDate,gpTone,gpOpenSettings,gpCloseSettings,gpRestorePrompts,gpReset,gpToggleMenu,gpMenuAction,renderHdr,openUserSettings,saveUserSettings,toggleMute,playCoinSound,playGoLiveSound});
gpLoad();if(user)renderHdr();

// Remember navigation windows per account/run/browser tab. Never replay an action.
const rwDraftTypes=['deposit','withdraw','configure','float'];
const rwFormOriginal=gsForm;
gsForm=function(type){const result=rwFormOriginal(type);const form=document.getElementById('gs-form');if(form){form.dataset.rwType=type;form.dataset.rwPhase='draft';}return result;};
const rwSubmitFormOriginal=gsSubmitForm;
gsSubmitForm=async function(...args){const form=document.getElementById('gs-form');if(form)form.dataset.rwPhase='submitted';rwCapture();try{return await rwSubmitFormOriginal(...args);}finally{rwCapture();}};
const rwViews={
 'gp-settings':{open:()=>gpOpenSettings(),leader:false},
 'attendance-overlay':{open:()=>openAttendanceManager(),leader:true},
 'settlements-dashboard':{open:()=>openSettlementsDashboard(),leader:true},
 'account-admin-overlay':{open:()=>openAccountAdmin(),leader:true},
 'gs-form':{open:view=>gsForm(view.type),leader:false}
};
let rwActiveKey='',rwQueuedKey='',rwRestoring=false;
function rwKey(){return user&&runId?'gdkp_windows_v1:'+JSON.stringify([String(discordUser?.id||user),String(runId)]):'';}
function rwScrollNodes(root){return [root,...root.querySelectorAll('.gp-settings-card,.account-payment-card,[data-scroll-key],.panel-body')];}
function rwViewState(root){return {id:root.id,...(root.id==='gs-form'?{type:root.dataset.rwType,fields:Object.fromEntries(['gs-amount','gs-address','gs-to'].map(id=>[id,root.querySelector('#'+id)?.value??'']))}:{}),scroll:rwScrollNodes(root).map(el=>[el.scrollLeft,el.scrollTop]),details:[...root.querySelectorAll('details')].map(el=>el.open),...(root.id==='settlements-dashboard'?{search:root.querySelector('input')?.value||'',filter:root.querySelector('[data-dashboard-filter]')?.value||'all',sort:root.querySelector('[data-dashboard-sort]')?.value||'oldest',queueOpen:root.dataset.queueOpen==='true'}:{})};}
function rwCapture(){
 const key=rwKey();if(!key||key!==rwActiveKey||rwRestoring||rwQueuedKey)return;
 const state={views:[...document.querySelectorAll(Object.keys(rwViews).map(id=>'#'+id).join(','))].filter(el=>(el.id!=='settlements-dashboard'||el.open)&&(el.id!=='gs-form'||(el.dataset.rwPhase==='draft'&&rwDraftTypes.includes(el.dataset.rwType)))).map(rwViewState),panel:panelOpen?{tab:panelTab,scroll:document.getElementById('side-panel')?rwViewState(document.getElementById('side-panel')).scroll:[]}:null};
 try{sessionStorage.setItem(key,JSON.stringify(state));}catch{}
}
function rwApplyViewState(root,saved){
 if(!root)return;
 if(root.id==='gs-form'){for(const id of ['gs-amount','gs-address','gs-to']){const field=root.querySelector('#'+id);if(field&&typeof saved.fields?.[id]==='string')field.value=saved.fields[id];}}
 if(root.id==='settlements-dashboard'){
  const search=root.querySelector('input'),filter=root.querySelector('[data-dashboard-filter]'),sort=root.querySelector('[data-dashboard-sort]');
  if(saved.queueOpen)root.querySelector('[data-dashboard-open]')?.click();
  if(sort&&[...sort.options].some(o=>o.value===saved.sort))sort.value=saved.sort;
  if(search)search.value=String(saved.search||'');
  if(filter&&[...filter.options].some(o=>o.value===saved.filter))filter.value=saved.filter;
  renderSettlementsDashboard();
 }
 if(Array.isArray(saved.details))[...root.querySelectorAll('details')].forEach((el,i)=>{el.open=!!saved.details[i];});
 const restoreScroll=()=>{if(!root.isConnected)return;rwScrollNodes(root).forEach((el,i)=>{const position=saved.scroll?.[i];if(Array.isArray(position)){el.scrollLeft=Number(position[0])||0;el.scrollTop=Number(position[1])||0;}});};
 restoreScroll();requestAnimationFrame(restoreScroll);
}
function rwScheduleRestore(){
 const key=rwKey();if(!key||key===rwActiveKey||key===rwQueuedKey)return;
 rwQueuedKey=key;
 queueMicrotask(()=>{
  if(rwKey()!==key){if(rwQueuedKey===key)rwQueuedKey='';rwScheduleRestore();return;}
  let saved=null;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
  rwRestoring=true;
  try{
   if(rwActiveKey&&rwActiveKey!==key){gpCloseSettings();closeAttendanceManager();closeSettlementsDashboard();document.getElementById('account-admin-overlay')?.remove();document.getElementById('gs-form')?.remove();closePanel();}
   rwActiveKey=key;
   if(saved?.panel&&['raiders','runs','audit'].includes(saved.panel.tab)){
    const target=isRL?saved.panel.tab:'runs';panelTab=target;openPanel();setPanelTab(target);
    rwApplyViewState(document.getElementById('side-panel'),saved.panel);
   }
   if(Array.isArray(saved?.views))for(const view of saved.views){
    if(!Object.hasOwn(rwViews,view?.id))continue;const spec=rwViews[view.id];if(spec.leader&&!isRL)continue;
    if(view.id==='gs-form'&&(!rwDraftTypes.includes(view.type)||(['configure','float'].includes(view.type)&&!isRL)))continue;
    if(!document.getElementById(view.id))spec.open(view);
    rwApplyViewState(document.getElementById(view.id),view);
   }
  }finally{rwRestoring=false;if(rwQueuedKey===key)rwQueuedKey='';rwCapture();}
 });
}
const rwRenderMainOriginal=renderMain;
renderMain=function(...args){const result=rwRenderMainOriginal(...args);rwScheduleRestore();return result;};
const rwLogoutOriginal=logout;
logout=function(...args){const key=rwKey();if(key)try{sessionStorage.removeItem(key);}catch{}rwActiveKey='';rwQueuedKey='';gpCloseSettings();closeAttendanceManager();closeSettlementsDashboard();document.getElementById('account-admin-overlay')?.remove();document.getElementById('gs-form')?.remove();return rwLogoutOriginal(...args);};
new MutationObserver(()=>{rwScheduleRestore();rwCapture();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class']});
for(const event of ['input','change','click','scroll','toggle'])document.addEventListener(event,rwCapture,true);
window.addEventListener('pagehide',rwCapture);
Object.assign(window,{renderMain,logout,gsForm,gsSubmitForm});
rwScheduleRestore();

// Godspeed Raid Tools layout v2. Navigation and presentation only.
let rtRosterQuery='',rtOpener=null,rtExpanded=false,rtGeometry=null;
function rtToggleExpanded(){rtExpanded=!rtExpanded;rtLayout();}
function rtLayout(){
 const panel=document.getElementById('side-panel');if(!panel)return;
 const workspace=rtExpanded;if(!rtGeometry||rtGeometry.width!==innerWidth||!panelOpen){const bounds=document.getElementById('main')?.getBoundingClientRect();rtGeometry={width:innerWidth,docked:!!(innerWidth>=1440&&bounds&&innerWidth-bounds.right>=472),top:Math.max(0,document.querySelector('.hdr')?.getBoundingClientRect().bottom||0)};}const docked=panelOpen&&!workspace&&rtGeometry.docked;const top=workspace?0:Math.min(rtGeometry.top,Math.max(0,innerHeight-240));document.documentElement.style.setProperty('--rt-top',top+'px');
 document.getElementById('rt-expand').textContent=workspace?'Collapse':'Expand';document.getElementById('rt-expand').setAttribute('aria-expanded',String(workspace));document.getElementById('rt-close').textContent='Close';document.getElementById('rt-close').setAttribute('aria-label',workspace?'Back to raid':'Close Raid Tools');document.getElementById('side-panel-body').setAttribute('aria-labelledby','panel-tab-'+panelTab);panel.classList.toggle('rt-workspace',workspace);panel.inert=!panelOpen;
 document.body.classList.toggle('rt-docked',docked);document.body.classList.toggle('rt-overlay',panelOpen&&!docked);
 document.getElementById('rt-scrim').hidden=!panelOpen||docked;
 panel.setAttribute('role',docked?'region':'dialog');if(docked||!panelOpen)panel.removeAttribute('aria-modal');else panel.setAttribute('aria-modal','true');
 document.getElementById('rt-title').textContent=panelTab==='audit'?'Raid audit':panelTab==='runs'?'Raid archive':'Raid Tools';
 document.getElementById('rt-subtitle').textContent=panelTab==='audit'?'Activity and changes for this raid':panelTab==='runs'?'Previous raids and their settlements':'Current roster and member details';
 for(const key of ['raiders','runs','audit']){const button=document.getElementById('panel-tab-'+key);button.hidden=!isRL&&key!=='runs';button.setAttribute('aria-selected',String(panelTab===key));button.tabIndex=panelTab===key?0:-1;}
 for(const button of document.querySelectorAll('.header-tools-btn')){button.setAttribute('aria-controls','side-panel');button.setAttribute('aria-expanded',String(panelOpen));button.onclick=()=>{if(panelOpen){closePanel();return;}openPanel();setPanelTab(isRL?'raiders':'runs');};}
}
function rtFilter(value){rtRosterQuery=value;const needle=value.trim().toLowerCase();let count=0;for(const row of document.querySelectorAll('.rt-person')){row.hidden=!row.dataset.name.includes(needle);if(!row.hidden)count++;}const empty=document.getElementById('rt-no-match');if(empty)empty.hidden=count>0;}
function rtMember(name){memberHistoryQuery=name;const input=document.getElementById('member-history-search');if(input){input.value=name;renderMemberHistoryResults();input.scrollIntoView({block:'nearest'});input.focus({preventScroll:true});}}
const rtOldRenderPanel=renderPanel;
renderPanel=function(...args){
 if(panelTab!=='raiders')return;
 const focused=document.activeElement?.id,position=document.activeElement?.selectionStart;const result=rtOldRenderPanel(...args);
 const body=document.getElementById('side-panel-body');if(!body||panelTab!=='raiders')return result;
 const history=body.querySelector('.member-history-search');if(history)body.append(history);
 const section=document.createElement('section');section.className='rt-section';
 section.innerHTML='<h3>Raiders</h3><div class="rm-views" role="group" aria-label="Member list"><button type="button" data-rm-view="raid" onclick="rmViewSet(\'raid\')">This Raid</button><button type="button" data-rm-view="all" onclick="rmViewSet(\'all\')">All Members</button></div><input class="rt-roster-search" id="rt-roster-search" type="search" aria-label="Search members" placeholder="Search character or @Discord name" /><p class="rm-hint">Checked in</p><div id="rm-list"></div><p id="rm-no-match" class="rt-empty" hidden>No matching members.</p>';
 section.querySelector('input').value=rtRosterQuery;section.querySelector('input').oninput=e=>{rtRosterQuery=e.target.value;rmFilter();};body.prepend(section);
 const attendanceButton=body.querySelector('button[onclick="openAttendanceManager()"]');if(attendanceButton){const actions=attendanceButton.parentElement;actions.className='uniform-actions';section.querySelector('.rm-views').after(actions);attendanceButton.onclick=()=>{closePanel();openAttendanceManager();};}
 rmPopulate();
 const title=document.createElement('h3');title.className='rt-purchases-title';title.textContent='Purchases this raid';section.after(title);
 for(const el of body.children)if(el.textContent==='No items sold yet')el.textContent='No purchases yet. Sold items will appear here.';
 if(['rt-roster-search','member-history-search'].includes(focused)){const input=document.getElementById(focused);input?.focus({preventScroll:true});if(position!=null)input?.setSelectionRange(position,position);}
 return result;
};
const rtOldSetPanelTab=setPanelTab;setPanelTab=function(t){if(!['raiders','runs','audit'].includes(t))return;if(!isRL)t='runs';const result=rtOldSetPanelTab(t);rtLayout();return result;};
const rtOldOpenPanel=openPanel;openPanel=function(...args){if(!panelOpen)rtOpener=document.activeElement;if(!isRL)panelTab='runs';const result=rtOldOpenPanel(...args);rtLayout();requestAnimationFrame(()=>{if(panelOpen&&!uiTopDialog())document.getElementById('panel-tab-'+panelTab)?.focus({preventScroll:true});});return result;};
const rtOldClosePanel=closePanel;closePanel=function(...args){const wasOpen=panelOpen;rtExpanded=false;const result=rtOldClosePanel(...args);rtLayout();if(wasOpen&&!uiTopDialog())(rtOpener?.isConnected?rtOpener:document.querySelector('.header-tools-btn'))?.focus({preventScroll:true});return result;};
const rtOldRenderHdr=renderHdr;renderHdr=function(...args){const result=rtOldRenderHdr(...args);document.querySelector('#hdr-user .header-state-button')?.remove();document.querySelector('#hdr-user button[onclick="openSettlementsDashboard()"]')?.remove();rtLayout();return result;};
const rtOldPotBar=buildPotBarHTML;
buildPotBarHTML=function(...args){const html=rtOldPotBar(...args);if(!isRL)return html;const template=document.createElement('template');template.innerHTML=html;const actions=template.content.querySelector('.pot-bar-actions');if(actions){const button=document.createElement('button');button.className='btn btn-outline rt-settlements';button.setAttribute('onclick','openSettlementsDashboard()');button.title='Outstanding payouts across current and archived raids';button.textContent='Settlements';const attendance=actions.querySelector('button[onclick="openAttendanceManager()"]');if(attendance)attendance.after(button);else actions.prepend(button);}return template.innerHTML;};
window.addEventListener('scroll',()=>{if(panelOpen)rtLayout();},{passive:true});
window.addEventListener('resize',rtLayout);
window.addEventListener('keydown',e=>{
 if(!panelOpen||uiTopDialog())return;
 if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(document.getElementById('rm-menu'))rmCloseMenu(true);else closePanel();return;}
 const panel=document.getElementById('side-panel');
 if(e.target.closest('.rt-nav')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const keys=isRL?['raiders','runs','audit']:['runs'];const i=keys.indexOf(panelTab);const key=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(i+(e.key==='ArrowLeft'?-1:1)+keys.length)%keys.length];setPanelTab(key);document.getElementById('panel-tab-'+key).focus();}
 if(e.key==='Tab'&&document.body.classList.contains('rt-overlay')){const nodes=uiFocusables(panel),i=nodes.indexOf(document.activeElement);if(!nodes.length)return;e.preventDefault();e.stopImmediatePropagation();nodes[(i+(e.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}
},true);
const rtOldLogout=logout;logout=function(...args){closePanel();rtRosterQuery='';return rtOldLogout(...args);};
Object.assign(window,{rtToggleExpanded,buildPotBarHTML,logout,openPanel,closePanel,setPanelTab,renderPanel,renderHdr,rtFilter,rtMember});
rtLayout();

// Raid member views and action menu.
let rmView='raid',rmRows=[],rmRequest=0,rmMenuOpener=null;
function rmPerson(name,s={}){return {name,discordId:String(s.discordId||''),discordName:s.discordName||'',personName:s.personName||s.displayName||name};}
function rmEntry(m){return Object.entries(attendance||{}).find(([,a])=>(!m.discordId||String(a?.discordId||'')===m.discordId)&&attendanceCharacterIdentity(a?.character)===attendanceCharacterIdentity(m.name))||null;}
function rmViewSet(view){rmView=view==='all'?'all':'raid';rmCloseMenu();rmPopulate();}
async function rmPopulate(){
 const target=document.getElementById('rm-list');if(!target)return;const request=++rmRequest,key=runId;
 document.querySelectorAll('[data-rm-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rmView===rmView)));
 let stats={};if(rmView==='all'){target.textContent='Loading members...';stats=await fetchCrossRunStats();if(request!==rmRequest||runId!==key||!target.isConnected)return;if(!stats){target.textContent='Could not load members. Try All Members again.';return;}}
 const map=new Map();const add=m=>{const id=attendanceCharacterIdentity(m.name);if(id)map.set(id,{...(map.get(id)||{}),...m});};
 if(rmView==='all')Object.entries(stats).forEach(([name,s])=>add(rmPerson(name,s)));
 Object.values(settlement.raiders||{}).forEach(r=>{if(r.name)add(rmPerson(r.name,stats?.[r.name]||{}));});
 attendanceList().filter(a=>a.character).forEach(a=>add(rmPerson(a.character,a)));
 rmRows=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
 target.innerHTML='';const fragment=document.createDocumentFragment();
 rmRows.forEach((m,i)=>{
  const entry=rmEntry(m),checked=!!entry?.[1]?.approved,row=document.createElement('div');row.className='rm-row';row.dataset.search=[m.name,m.discordName,m.personName].join(' ').toLowerCase();
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=checked;checkbox.disabled=!isRL||(!entry&&!m.discordId);checkbox.setAttribute('aria-label','Checked in: '+m.name);checkbox.title=checked?'Checked in'+(entry[1].checkInSource==='leader'?' by a leader':''):m.discordId||entry?'Check in':'Discord identity required for manual check-in';checkbox.onchange=()=>rmCheck(m,checkbox.checked,checkbox);
  const name=document.createElement('button');name.type='button';name.className='rm-name';name.textContent=m.name;name.onclick=()=>rtMember(m.name);
  const detail=document.createElement('small');detail.textContent=m.discordName?'@'+m.discordName.replace(/^@+/,''):checked?'Checked in':'Not checked in';name.append(document.createElement('br'),detail);
  const more=document.createElement('button');more.type='button';more.className='rm-more';more.textContent='⋯';more.setAttribute('aria-label','Actions for '+m.name);more.setAttribute('aria-haspopup','menu');more.onclick=e=>rmOpenMenu(m,more,e);
  row.append(checkbox,name,more);row.oncontextmenu=e=>{e.preventDefault();rmOpenMenu(m,more,e);};row.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();rmOpenMenu(m,more,e);}};fragment.append(row);
 });target.append(fragment);if(!rmRows.length)target.textContent=rmView==='all'?'No saved members yet.':'No attendees yet.';rmFilter();
}
function rmFilter(){const needle=String(document.getElementById('rt-roster-search')?.value||'').trim().toLowerCase().replace(/^@/,'');let n=0;document.querySelectorAll('.rm-row').forEach(row=>{row.hidden=!row.dataset.search.includes(needle);if(!row.hidden)n++;});const msg=document.getElementById('rm-no-match');if(msg)msg.hidden=n>0||!rmRows.length;}
async function rmCheck(m,checked,input){
 if(!isRL){if(input)input.checked=!checked;return;}const keyRun=runId,entry=rmEntry(m);
 if(checked&&isBanned({name:m.personName,discordId:m.discordId})){toast('Unban this member before checking them in');if(input)input.checked=false;return;}
 const accountEntry=m.discordId?Object.values(attendance||{}).find(a=>String(a?.discordId||'')===m.discordId):null;
 if(checked&&accountEntry&&attendanceCharacterIdentity(accountEntry.character)!==attendanceCharacterIdentity(m.name)){toast('Use Attendance to change this account’s character');if(input)input.checked=false;return;}
 const key=entry?.[0]||(m.discordId?'discord_'+m.discordId:'');if(!key){toast('A Discord identity is required');if(input)input.checked=false;return;}
 if(checked&&entry&&attendanceCharacterIdentity(entry[1].character)!==attendanceCharacterIdentity(m.name)){toast('Use Attendance to change this account’s character');if(input)input.checked=false;return;}
 if(checked&&attendanceCharacterTaken(m.name,key)){toast('This character is already checked in');if(input)input.checked=false;return;}
 if(input)input.disabled=true;
 try{
  const data={approved:checked,checkInSource:'leader',checkInChangedBy:String(discordUser?.id||user||''),checkInChangedAt:Date.now()};
  if(checked)data.checkedInAt=Date.now();
  if(entry)await update(runRef('/attendance/'+key),data);
  else await set(runRef('/attendance/'+key),{...data,discordId:m.discordId,discordName:m.discordName,personName:m.personName,character:m.name,purchasePreference:'usd'});
  if(runId===keyRun){toast(checked?m.name+' checked in':m.name+' check-in cleared');rmPopulate();}
 }catch(e){if(input)input.checked=!checked;toast('Could not save check-in. Please try again.');}
 finally{if(input)input.disabled=false;}
}
function rmCloseMenu(focus=false){document.getElementById('rm-menu')?.remove();if(rmMenuOpener){rmMenuOpener.setAttribute('aria-expanded','false');if(focus&&rmMenuOpener.isConnected)rmMenuOpener.focus();}rmMenuOpener=null;}
function rmOpenMenu(m,opener,event){
 rmCloseMenu();rmMenuOpener=opener;opener?.setAttribute('aria-expanded','true');const menu=document.createElement('div');menu.id='rm-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Actions for '+m.name);
 const add=(label,fn,disabled=false,danger=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('role','menuitem');b.disabled=disabled;if(danger)b.className='rm-danger';b.onclick=()=>{rmCloseMenu();fn();};menu.append(b);};
 add('View history',()=>rtMember(m.name));
 if(isRL){const entry=rmEntry(m),banned=isBanned({name:m.personName,discordId:m.discordId});add(entry?.[1]?.approved?'Undo check-in':'Check in',()=>rmCheck(m,!entry?.[1]?.approved),!entry&&!m.discordId);
  const divider=document.createElement('hr');menu.append(divider);
  add('Remove from current raid',()=>{const current=rmEntry(m);if(current)removeAttendanceMember(current[0]);},!entry,true);
  add('Remove from payout roster',()=>memberHistoryAction(encodeURIComponent(m.name),'remove'),!settlement.raiders?.[settlementRaiderKey(m.name)]||settlementSetupLocked(),true);
  add(banned?'Unban from site':'Ban from site',()=>{const member={name:m.personName,discordId:m.discordId,discordName:m.discordName};if(banned)unban(banKey(member));else kickBan(member);},m.discordId===String(RAID_LEADER_DISCORD_ID),true);
 }
 // Keep the menu inside the existing dialog so keyboard focus remains contained.
 document.getElementById('side-panel').append(menu);const r=opener?.getBoundingClientRect(),x=event?.type==='contextmenu'?event.clientX:r?.left||16,y=event?.type==='contextmenu'?event.clientY:r?.bottom||16;
 const panelRect=document.getElementById('side-panel').getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x-panelRect.left,panelRect.width-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y-panelRect.top,panelRect.height-menu.offsetHeight-8))+'px';menu.querySelector('button:not(:disabled)')?.focus();
 menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}});
}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#rm-menu')&&!e.target.closest('.rm-more'))rmCloseMenu();},true);
document.addEventListener('keydown',e=>{if(document.getElementById('rm-menu')&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();rmCloseMenu(true);}},true);
const rmClosePanel=closePanel;closePanel=function(...args){rmCloseMenu();return rmClosePanel(...args);};
const rmSetPanelTab=setPanelTab;setPanelTab=function(...args){rmCloseMenu();return rmSetPanelTab(...args);};
const rmHistory=renderMemberHistoryResults;renderMemberHistoryResults=async function(...args){await rmHistory(...args);document.querySelectorAll('.member-history-result').forEach(card=>{card.querySelector('.member-history-actions')?.remove();const name=card.querySelector('summary>span')?.textContent;if(!name)return;const m=rmPerson(name,crossRunCache?.[name]||{});card.oncontextmenu=e=>{e.preventDefault();rmOpenMenu(m,card.querySelector('summary'),e);};});};
Object.assign(window,{rmViewSet,rmPopulate,rmFilter,rmCloseMenu,closePanel,setPanelTab,renderMemberHistoryResults});

// Floating queue position is a local presentation preference.
const fqStorageKey='godspeed_queue_position_v1';let fqPosition=null,fqDrag=null;
try{const p=JSON.parse(localStorage.getItem(fqStorageKey));if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))fqPosition=p;}catch{}
function fqClamp(x,y,width,height,vw=innerWidth,vh=innerHeight){return{x:Math.max(8,Math.min(x,Math.max(8,vw-width-8))),y:Math.max(8,Math.min(y,Math.max(8,vh-height-8))) };}
function fqPlace(){const panel=document.querySelector('.queue-panel');if(!panel)return;frPrepare(panel);const rect=panel.getBoundingClientRect(),p=fqPosition||{x:innerWidth-rect.width-24,y:Math.min(110,Math.max(16,(innerHeight-rect.height)/2))},clamped=fqClamp(p.x,p.y,rect.width,rect.height);panel.style.setProperty('--fq-x',clamped.x+'px');panel.style.setProperty('--fq-y',clamped.y+'px');const title=panel.querySelector('.modal-title');if(title){title.tabIndex=0;title.title='Drag to move. When focused, use arrow keys to move.';title.setAttribute('aria-label','Item queue. Drag or use arrow keys to move.');}}
function fqSave(){try{localStorage.setItem(fqStorageKey,JSON.stringify(fqPosition));}catch{}}
function fqReset(){fqPosition=null;frSize=null;try{localStorage.removeItem('godspeed_queue_size_v1');}catch{}try{localStorage.removeItem(fqStorageKey);}catch{}fqPlace();}
document.addEventListener('pointerdown',e=>{const title=e.target.closest('.queue-panel .modal-title');if(!title||e.target.closest('button')||e.button!==0)return;const panel=title.closest('.queue-panel'),r=panel.getBoundingClientRect();fqDrag={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};title.setPointerCapture?.(e.pointerId);e.preventDefault();},true);
document.addEventListener('pointermove',e=>{if(!fqDrag||e.pointerId!==fqDrag.id)return;const panel=document.querySelector('.queue-panel');if(!panel){fqDrag=null;return;}const r=panel.getBoundingClientRect();fqPosition=fqClamp(e.clientX-fqDrag.dx,e.clientY-fqDrag.dy,r.width,r.height);fqPlace();},true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>{if(fqDrag&&e.pointerId===fqDrag.id){fqDrag=null;fqSave();}},true);
document.addEventListener('keydown',e=>{if(!e.target.matches('.queue-panel .modal-title')||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const r=e.target.closest('.queue-panel').getBoundingClientRect();fqPosition=fqClamp(r.left+(e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0),r.top+(e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0),r.width,r.height);fqPlace();fqSave();});
new MutationObserver(fqPlace).observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',fqPlace);Object.assign(window,{fqReset});fqPlace();

var frSize=null,frDrag=null;
try{const s=JSON.parse(localStorage.getItem('godspeed_queue_size_v1'));if(s&&Number.isFinite(s.w)&&Number.isFinite(s.h))frSize=s;}catch{}
function frPrepare(panel){
 const s=frSize||{w:720,h:680};panel.style.setProperty('width',Math.min(Math.max(360,s.w),innerWidth-16)+'px','important');panel.style.setProperty('height',Math.min(Math.max(320,s.h),innerHeight-32)+'px','important');
 if(!panel.querySelector('.fr-handle'))for(const side of ['n','s','e','w','ne','nw','se','sw']){const h=document.createElement('div');h.className='fr-handle fr-'+side;h.dataset.side=side;h.setAttribute('aria-hidden','true');panel.append(h);}
}
window.addEventListener('pointerdown',e=>{const handle=e.target.closest('.fr-handle');if(!handle||e.button!==0)return;const r=handle.parentElement.getBoundingClientRect();frDrag={side:handle.dataset.side,id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,w:r.width,h:r.height};handle.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopImmediatePropagation();},true);
window.addEventListener('pointermove',e=>{if(!frDrag||e.pointerId!==frDrag.id)return;const d=frDrag,dx=e.clientX-d.x,dy=e.clientY-d.y;let w=d.w,h=d.h;if(d.side.includes('e'))w+=dx;if(d.side.includes('w'))w-=dx;if(d.side.includes('s'))h+=dy;if(d.side.includes('n'))h-=dy;w=Math.min(Math.max(Math.min(360,innerWidth-16),w),innerWidth-16);h=Math.min(Math.max(Math.min(320,innerHeight-32),h),innerHeight-32);frSize={w,h};fqPosition={x:d.side.includes('w')?d.left+d.w-w:d.left,y:d.side.includes('n')?d.top+d.h-h:d.top};fqPlace();e.preventDefault();e.stopImmediatePropagation();},true);
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>{if(frDrag&&e.pointerId===frDrag.id){frDrag=null;try{localStorage.setItem('godspeed_queue_size_v1',JSON.stringify(frSize));}catch{}fqSave();}},true);
fqPlace();

// One short clunk per deliberate tab activation. Uses the account's sound settings.

function mtTabClunk(){
 if(gp.muted||!gp.soundTabs||Number(gp.volume)<=0)return;
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
  if(!gpAudioContext||gpAudioContext.state==='closed')gpAudioContext=new Audio();
  const mtAudio=gpAudioContext;
  const play=()=>{if(gp.muted||!gp.soundTabs)return;const ctx=mtAudio,t=ctx.currentTime,v=Math.min(1,Math.max(0,Number(gp.volume)/100));
   const out=ctx.createGain();out.gain.setValueAtTime(v*.55,t);out.connect(ctx.destination);
   const body=ctx.createOscillator(),amp=ctx.createGain();body.type='triangle';body.frequency.setValueAtTime(170,t);body.frequency.exponentialRampToValueAtTime(65,t+.09);amp.gain.setValueAtTime(.001,t);amp.gain.linearRampToValueAtTime(.7,t+.003);amp.gain.exponentialRampToValueAtTime(.001,t+.13);body.connect(amp);amp.connect(out);body.start(t);body.stop(t+.14);
   const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.065),ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*.012));
   const hit=ctx.createBufferSource(),filter=ctx.createBiquadFilter();hit.buffer=buffer;filter.type='lowpass';filter.frequency.value=1500;hit.connect(filter);filter.connect(out);hit.start(t);hit.stop(t+.07);
   body.onended=()=>{body.disconnect();amp.disconnect();hit.disconnect();filter.disconnect();out.disconnect();};
  };
  if(mtAudio.state==='suspended')mtAudio.resume().then(play).catch(()=>{});else play();
 }catch{}
}
window.addEventListener('click',e=>{if(!e.isTrusted)return;const target=e.target.closest?.('button,.tab,[role="button"],[role="tab"],[role="menuitem"],.usr-chip');if(!target||target.matches(':disabled,[aria-disabled="true"]')||target.closest('[inert]'))return;if(target.getAttribute('onclick')?.includes('gpTone('))return;mtTabClunk();},true);
window.addEventListener('keydown',e=>{if(!e.isTrusted||e.repeat||!['Enter',' '].includes(e.key))return;const el=e.target;if(el.matches?.('.tab:not(button),[role="tab"]:not(button)'))mtTabClunk();},true);

// Confirmed coin-mode bid snapshots drive shared jingles, including custom bids.
let bjScope='',bjSeen=new Set(),bjLast=0,bjAudio=null,bjLeaders={};
function bjObserve(list){
 if(!gsContext())return;
 const scope=String(runId)+':'+String(discordUser?.id||''),initial=scope!==bjScope;
 if(initial){bjScope=scope;bjSeen=new Set();bjLeaders={};}
 const mine=String(discordUser?.id||''),fresh=[];let outbid=false;const leaders={};
 for(const [id,a] of Object.entries(list||{})){
  const bids=Object.entries(a.bids||{}).filter(([,b])=>!b.retracted).sort((a,b)=>b[1].amount-a[1].amount);
  leaders[id]=String(bids[0]?.[1]?.discordId||'');
  for(const [bidId,b] of bids){const key=id+':'+bidId;if(!bjSeen.has(key)){bjSeen.add(key);if(!initial&&a.status==='open')fresh.push(b);}}
  if(!initial&&bjLeaders[id]===mine&&leaders[id]&&leaders[id]!==mine)outbid=true;
 }
 bjLeaders=leaders;if(initial||!fresh.length)return;
 const own=fresh.some(b=>String(b.discordId||'')===mine);
 if(!own&&outbid)return; // Existing personal outbid alert takes priority.
 bjJingle(own);
}
function bjJingle(own){
 if(gp.muted||!gp.volume||(own?!gp.soundBid:!gp.soundActivity))return;
 const now=Date.now();if(now-bjLast<350)return;bjLast=now;
 try{if(bjAudio){bjAudio.pause();bjAudio=null;}const audio=new Audio(_coinSrc);bjAudio=audio;audio.volume=Math.min(1,(own?.32:.11)*gp.volume/100);audio.onended=()=>{if(bjAudio===audio)bjAudio=null;};audio.play().catch(()=>{});}catch{}
}
const bjApply=gpApply;gpApply=function(...args){const r=bjApply(...args);if(bjAudio){if(gp.muted||!gp.volume||(!gp.soundBid&&!gp.soundActivity)){bjAudio.pause();bjAudio=null;}}return r;};

// Balance homogeneous action groups using their available width and label sizes.
function rcColumns(count,width,minWidth){const capacity=Math.max(1,Math.floor((width+12)/(minWidth+12)));return Math.max(1,Math.ceil(count/Math.ceil(count/Math.min(count,capacity))));}
const rcSelector='.pot-bar-actions,.uniform-actions,.modal-actions,.account-action-grid,.account-footer-actions,.settlement-footer-actions,.purchase-actions,.archive-card-actions,.archived-header-actions,.q-row';
const rcObserved=new WeakSet(),rcCanvas=document.createElement('canvas');let rcFrame=0;
function rcSize(group){const items=[...group.children].filter(el=>!el.hidden&&getComputedStyle(el).display!=='none');if(!items.length||items.some(el=>!el.matches('button,.btn')))return;
 const ctx=rcCanvas.getContext('2d');let minWidth=140;
 for(const el of items){const style=getComputedStyle(el);if(ctx){ctx.font=style.font||`${style.fontSize} ${style.fontFamily}`;minWidth=Math.max(minWidth,Math.min(240,ctx.measureText(el.textContent.trim()).width+40));}}
 const columns=rcColumns(items.length,group.clientWidth,minWidth);group.classList.add('rc-balanced');const value=String(columns);if(group.style.getPropertyValue('--rc-columns')!==value)group.style.setProperty('--rc-columns',value);
}
const rcResize=new ResizeObserver(entries=>{for(const entry of entries)rcSize(entry.target);});
function rcScan(){cancelAnimationFrame(rcFrame);rcFrame=requestAnimationFrame(()=>{document.querySelectorAll(rcSelector).forEach(group=>{if(!rcObserved.has(group)){rcObserved.add(group);rcResize.observe(group);}rcSize(group);});});}
new MutationObserver(rcScan).observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',rcScan);document.fonts?.ready.then(rcScan);rcScan();

// A permanent personal summary keeps purchases from shifting the auction layout.
const psOriginalLoot=buildMyLootHTML;
buildMyLootHTML=function(){return '';};
function psPurchases(){
 if(gsContext()){const id=String(accountDiscordId()||'');const items=id?auctionList().filter(a=>a.status==='sold'&&gcWinnerId(a)===id):[];return {items,count:items.length,due:items.filter(a=>settlement.gsPayments?.[a.id]?.status!=='paid').reduce((sum,a)=>sum+Number(a.currentBid||0),0)};}
 const items=getRaiderLoot(user);return {items,count:items.length,due:items.filter(a=>!a.paid).reduce((sum,a)=>sum+Number(a.price||0),0)};
}
function psSummaryHTML(){const p=psPurchases();return `<div class="ps-summary"><span>Your purchases: <strong>${p.count}</strong></span><span>Owed: <strong>${displayMoney(p.due)}</strong></span><button type="button" class="btn btn-outline btn-sm" onclick="psOpen()">Review &amp; Pay</button></div>`;}
const psPot=buildPotBarHTML;buildPotBarHTML=function(...args){const template=document.createElement('template');template.innerHTML=psPot(...args)||'<div class="pot-bar"><div class="pot-bar-stat"><div class="pot-lbl">Total Pot</div><div class="pot-val">'+displayMoney(pot())+'</div></div></div>';template.content.querySelector('.pot-bar')?.insertAdjacentHTML('beforeend',psSummaryHTML());return template.innerHTML;};
function psDetailsHTML(){const p=psPurchases();if(!p.count)return '<p class="settlement-muted">You have no purchases in this raid.</p>';if(!gsContext())return psOriginalLoot();return `<div class="ps-funds"><span>Owed: <strong>${displayMoney(p.due)}</strong></span><span>Available: <strong data-gc-available>${gcAvailable()}</strong></span></div>`+p.items.map(a=>{const paid=settlement.gsPayments?.[a.id]?.status==='paid';return `<div class="ps-item"><span>${gcEsc(a.name)}<small>${gcMoney(a.currentBid)}</small></span>${paid?'<span class="settlement-status ok">Paid</span>':`<button class="btn btn-green" onclick="gsPay('${a.id}')">Pay ${gcMoney(a.currentBid)}</button>`}</div>`;}).join('');}
function psOpen(){document.getElementById('ps-purchases')?.remove();const overlay=document.createElement('div');overlay.id='ps-purchases';overlay.className='account-payment-overlay';overlay.style.zIndex='190';overlay.innerHTML='<div class="account-payment-card ps-card"><div class="settlement-section-hdr"><h2>Your Purchases</h2><button class="btn btn-outline" onclick="psClose()">Close</button></div><div id="ps-details"></div><div class="uniform-actions"><button class="btn btn-outline" onclick="psClose();gsForm(\'deposit\')">Add funds</button><button class="btn btn-outline" onclick="psClose();openUserSettings()">Account</button></div></div>';overlay.addEventListener('click',e=>{if(e.target===overlay)psClose();});document.body.append(overlay);if(!gsContext())overlay.querySelector('.uniform-actions button').remove();psRefresh();overlay.querySelector('button')?.focus();}
function psClose(){document.getElementById('ps-purchases')?.remove();}
function psRefresh(){document.querySelectorAll('#main > .my-loot,#main > .purchase-summary').forEach(el=>el.remove());const details=document.getElementById('ps-details');if(details){const html=psDetailsHTML();if(details.dataset.rendered!==html){hybridRender(details,html,JSON.stringify([accountDiscordId(),settlementRunKey()]));details.dataset.rendered=html;}}}
const psRefreshPot=refreshPotAndLoot;refreshPotAndLoot=function(...args){const result=psRefreshPot(...args);psRefresh();return result;};
const psMain=renderMain;renderMain=function(...args){const result=psMain(...args);psRefresh();return result;};
const psGsRefresh=gsRefresh;gsRefresh=async function(...args){const result=await psGsRefresh(...args);psRefresh();return result;};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&uiTopDialog()?.id==='ps-purchases'){e.preventDefault();e.stopImmediatePropagation();psClose();}},true);
Object.assign(window,{psOpen,psClose,buildPotBarHTML,buildMyLootHTML,refreshPotAndLoot,renderMain,gsRefresh});

// Simplified leader settings. Existing ledger commands and fee values are retained.
gsSetup=function(){
 const s=settlement,l=s.gsCutLines||{lead:15,treasury:5,risk:5,handling:0},labels={lead:'Raid leader',treasury:'Treasury',risk:'Risk reserve',handling:'Gold handling'};
 const total=Object.values(l).reduce((n,v)=>n+Number(v||0),0),gold=s.settlementMode==='mixed'&&!!s.goldEnabled;
 return `<section class="settlement-section sr-settings"><h3>Run Settings</h3><p class="settlement-muted">GC is used for bids. You can also accept gold for this run.</p><div class="sr-main"><label class="sr-check"><input type="checkbox" id="gs-gold" ${gold?'checked':''}> Accept gold payments</label><label>Exchange rate: USDC per 1,000 gold<input id="gs-rate" type="number" min=".01" step=".01" value="${runUsdRate()}"></label></div><p>Total run fees: <strong>${total}%</strong>${s.gsTaper?' · fee cap enabled':''}</p><details class="sr-details"><summary>Fee details</summary><div class="gs-fields">${Object.entries(labels).map(([k,label])=>`<label>${label} %<input id="gs-line-${k}" type="number" min="0" max="100" step=".01" value="${Number(l[k]||0)}"></label>`).join('')}<label class="sr-check"><input type="checkbox" id="gs-taper" ${s.gsTaper?'checked':''}> Cap fees at 20% of the first 2,000 GC and 15% above that</label><label>Fee after the withdrawal deadline<select id="gs-haircut">${[0,5,10].map(n=>`<option value="${n}" ${Number(s.gsHaircutPct||0)===n?'selected':''}>${n}%</option>`).join('')}</select></label></div><p class="settlement-muted">The withdrawal window lasts 48 hours after cuts lock.</p></details><div class="sr-save"><button class="btn btn-gold" onclick="gsSaveMode()">Save Run Settings</button><p class="settlement-muted">Save before adding items. These settings require an empty run.</p></div><details class="sr-details"><summary>Deposits, withdrawals &amp; wallet</summary><div id="gs-admin-queue">${gsAdminQueue()}</div></details></section>`;
};
gsSaveMode=function(){
 if(!isRL)return;
 const gold=!!document.getElementById('gs-gold')?.checked,rate=Number(gsField('gs-rate')),lines=Object.fromEntries(['lead','treasury','risk','handling'].map(k=>[k,Number(gsField('gs-line-'+k))]));
 if(!Number.isFinite(rate)||rate<=0){toast('Enter an exchange rate greater than zero');return;}
 if(Object.values(lines).some(v=>!Number.isFinite(v)||v<0||v>100)||Object.values(lines).reduce((n,v)=>n+v,0)>100){toast('Total fees must be between 0% and 100%');return;}
 gsAction('mode',{runId:settlementRunKey(),mode:gold?'mixed':'coin',rate,lines,haircut:Number(gsField('gs-haircut')),goldEnabled:gold,taper:!!document.getElementById('gs-taper')?.checked},`Save this run with ${gold?'GC and gold payments':'GC payments'}, an exchange rate of ${rate} USDC per 1,000 gold, and ${Object.values(lines).reduce((n,v)=>n+v,0)}% total fees?`);
};
const srAdminQueue=gsAdminQueue;
gsAdminQueue=function(){return srAdminQueue().replaceAll('House float:','Available treasury GC:').replaceAll('reserve:','USDC reserve:').replaceAll('Transfer Float','Transfer Treasury GC').replaceAll('Match Deposit','Match a Deposit').replaceAll('Expired Tickets','Review Overdue Withdrawals').replaceAll('Return Remainder','Return Unused Run Funds');};
Object.assign(window,{gsSaveMode});

// One leader-only admin cut; currency display remains available independently.
function acPercent(){return Object.values(settlement.gsCutLines||{lead:15,treasury:5,risk:5,handling:0}).reduce((n,v)=>n+Number(v||0),0);}
gsSetup=function(){if(!isRL)return '';const gold=settlement.settlementMode==='mixed'&&!!settlement.goldEnabled;return `<section class="settlement-section sr-settings"><h3>Run Settings</h3><div class="sr-main"><label>Admin cut (%)<input id="ac-percent" type="number" min="0" max="100" step=".01" value="${acPercent()}"></label><label>1,000 gold equals how much USDC?<input id="gs-rate" type="number" min=".01" step=".01" value="${runUsdRate()}"></label><label class="sr-check"><input id="gs-gold" type="checkbox" ${gold?'checked':''}> Accept gold payments</label></div><p>Gold payments are currently <strong>${gold?'enabled':'disabled'}</strong>.</p><div class="sr-save"><button class="btn btn-gold" onclick="gsSaveMode()">Save Settings</button><p class="settlement-muted" id="ac-result" role="status">Set these before adding items. The gold bag at the top switches the displayed amounts.</p></div><details class="sr-details"><summary>Manage deposits and withdrawals</summary><div id="gs-admin-queue">${gsAdminQueue()}</div></details></section>`;};
gsSaveMode=async function(){
 if(!isRL||gsBusy)return;const rate=Number(gsField('gs-rate')),cut=Number(gsField('ac-percent')),gold=!!document.getElementById('gs-gold')?.checked,box=document.getElementById('ac-result');
 const say=t=>{if(box)box.textContent=t;};
 if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(cut)||cut<0||cut>100){say('Enter a positive exchange rate and an admin cut from 0 to 100%.');return;}
 if(archivedSettlementContext||Object.keys(auctions||{}).length||settlement.payoutStarted){say('This run already has items or payouts. Start a new run to change these settings. You can still click the gold bag to view gold amounts.');return;}
 gsBusy=true;say('Saving…');try{await gsCall('mode',{runId:settlementRunKey(),mode:gold?'mixed':'coin',rate,lines:{lead:cut,treasury:0,risk:0,handling:0},haircut:Number(settlement.gsHaircutPct||0),goldEnabled:gold,taper:false});say('Saved. Gold payments '+(gold?'enabled.':'disabled.'));toast('Run settings saved');}catch(e){say(e.message||'Settings could not be saved.');}finally{gsBusy=false;}
};
gsHelp=function(){return '<details class="gc-wallet-details" data-gc-key="coin-help"><summary>Withdrawal terms</summary><p>1 GC = 1 USDC. The withdrawal window lasts 48 hours after cuts lock.</p>'+(Number(settlement.gsHaircutPct||0)?'<p>Fee after the withdrawal deadline: '+Number(settlement.gsHaircutPct)+'%.</p>':'')+'</details>';};
const acDisplay=displayMoney;
displayMoney=function(n,rate=runUsdRate()){if(gsContext()&&gcGoldView)return (Number(n)*1000/Number(rate)).toLocaleString(undefined,{maximumFractionDigits:2})+'g';return acDisplay(n,rate);};
const acCurrency=setDisplayCurrency;
setDisplayCurrency=function(next){if(gsContext()&&next==='goldunit'){gcGoldView=true;displayCurrency='gold';localStorage.setItem('gdkp_display_currency','gold');renderHdr();renderMain();return;}return acCurrency(next);};
const acHeader=renderHdr;
renderHdr=function(){acHeader();if(!gsContext())return;const bag=document.querySelector('#hdr-user .currency-toggle button:last-child');if(bag){bag.disabled=false;bag.title='Show amounts in gold';bag.setAttribute('aria-label','Show amounts in gold');bag.classList.toggle('active',gcGoldView);}};
const acSettlement=renderSettlement;
renderSettlement=function(){const html=acSettlement();if(!isRL)return html;const t=document.createElement('template');t.innerHTML=html;if(gsContext())t.content.querySelectorAll('.cut-setup-controls').forEach(e=>e.remove());return t.innerHTML;};
Object.assign(window,{gsSaveMode,setDisplayCurrency});

// New-run setup collects and commits the whole configuration together.
let nrSaving=false,nrSource='';
confirmReset=function(){
 if(!isRL)return;if(archivedSettlementContext){toast('Return to the current run first');return;}
 if(nrSaving)return;document.getElementById('nr-setup')?.remove();nrSource=runId;
 const el=document.createElement('div');el.id='nr-setup';el.className='account-payment-overlay';el.style.zIndex='190';
 el.innerHTML=`<form class="account-payment-card nr-card" novalidate><h2>Start New Run</h2><p>The current run will be archived when you start.</p><label>Raid title<input id="nr-title" maxlength="100" placeholder="e.g. Friday Karazhan" required autocomplete="off"></label><fieldset><legend>Accepted currencies</legend>${cuChecks('nr',cuPolicy())}<p class="settlement-muted">Select the currencies you will accept for purchases.</p></fieldset><label>1,000 gold equals how much USDC?<input id="nr-rate" type="number" min=".01" step=".01" required value="${runUsdRate()}"></label><label>Admin cut (%)<input id="nr-cut" type="number" min="0" max="100" step=".01" required value="${gsContext()?acPercent():Number(settlement.managementCut||0)}"></label><p class="settlement-muted">The admin cut is visible to the raid leader.</p><p id="nr-error" role="status"></p><div class="uniform-actions"><button type="button" class="btn btn-outline" onclick="nrClose()">Cancel</button><button type="submit" class="btn btn-gold">Start New Run</button></div></form>`;
 el.querySelector('form').addEventListener('submit',e=>{e.preventDefault();nrStart();});document.body.append(el);el.querySelector('input').focus();
};
function nrClose(){if(!nrSaving)document.getElementById('nr-setup')?.remove();}
function nrSettings(title,rate,cut,gold,currencies){
 cuValidate(currencies);
 if(!title.trim()||title.length>100||!Number.isFinite(rate)||rate<=0||!Number.isFinite(cut)||cut<0||cut>100)throw Error('Enter a title, a positive exchange rate, and an admin cut from 0 to 100%.');
 return {...JSON.parse(JSON.stringify(DEFAULT_SETTLEMENT)),settlementMode:gold?'mixed':'coin',goldEnabled:gold,acceptedCurrencies:currencies,managementCut:cut,gsCutLines:{lead:cut,treasury:0,risk:0,handling:0},gsTaper:false,gsHaircutPct:Number(settlement.gsHaircutPct||0),gsWindowHours:48,usdPer1000:rate,usdcPer1000:rate,rateLocked:true,rateLockedAt:Date.now(),rateLockedBy:user,mutators:JSON.parse(JSON.stringify(settlement.mutators||{}))};
}
async function nrStart(){
 if(nrSaving||!isRL)return;const el=document.getElementById('nr-setup'),error=el?.querySelector('#nr-error');if(!el)return;
 if(nrSource!==runId||archivedSettlementContext){error.textContent='The current run changed. Close this window and try again.';return;}
 let next;const title=el.querySelector('#nr-title').value.trim();try{const currencies=cuRead('nr');cuValidate(currencies);next=nrSettings(title,Number(el.querySelector('#nr-rate').value),Number(el.querySelector('#nr-cut').value),currencies.gold,currencies);}catch(e){error.textContent=e.message;return;}
 nrSaving=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);error.textContent='Starting run…';
 const key=push(ref(db,'runs')).key,settings={...raidSettings,raidTitle:title},now=Date.now();
 try{
 const writes={};writes[nrSource+'/archived']=true;writes[nrSource+'/archivedAt']=now;writes[nrSource+'/lootDisplay']=false;writes[nrSource+'/archiveDisplay']=null;
 writes[key]={createdAt:now,settings,auctions:{},settlement:next,attendance:{},attendanceSettings:{enabled:false,open:false},siteContent:JSON.parse(JSON.stringify(siteContent||{}))};
 await update(ref(db,'runs'),writes);
 runId=key;settlement=next;raidSettings=settings;auctions={};attendance={};attendanceSettings={enabled:false,open:false};splitsLoaded=false;splits=JSON.parse(JSON.stringify(DEFAULT_SPLITS));payoutDraftImage=null;payoutDraftFields={seller:'',item:'',wallet:'',dirty:false};payoutDraftMethod='';rlAttendanceEnsuredFor='';lootDisplayMode=false;tab='active';
 document.getElementById('loot-display-overlay')?.remove();localStorage.removeItem('gdkp_archive_display');localStorage.setItem('gdkp_management_cut',String(next.managementCut));el.remove();subscribeToRun();subscribeSiteContent();render();toast('New run started');
 }catch(e){error.textContent=e.message||'Could not start the run. Please try again.';el.querySelectorAll('button').forEach(b=>b.disabled=false);}finally{nrSaving=false;}
}
Object.assign(window,{confirmReset,nrClose});

// Accepted payment currencies are distinct from the header's display units.
function cuPolicy(){return settlement.acceptedCurrencies||{gc:true,gold:settlement.settlementMode==='mixed'&&!!settlement.goldEnabled,usd:false};}
function cuValidate(c){if(!c||!['gc','gold','usd'].every(k=>typeof c[k]==='boolean')||!Object.values(c).some(Boolean))throw Error('Select at least one currency.');return c;}
function cuChecks(prefix,c){return [['gc','GC'],['gold','GOLD'],['usd','USD/USDC']].map(([k,label])=>`<label class="nr-check"><input type="checkbox" id="${prefix}-${k}" ${c[k]?'checked':''}> ${label}</label>`).join('');}
function cuRead(prefix){return Object.fromEntries(['gc','gold','usd'].map(k=>[k,!!document.getElementById(prefix+'-'+k)?.checked]));}
function cuNames(c){return [['gc','GC'],['gold','Gold'],['usd','USD/USDC']].filter(([k])=>c[k]).map(([,name])=>name).join(', ');}
let cuSaving=false;
function cuOpen(){if(!isRL)return;document.getElementById('cu-dialog')?.remove();const el=document.createElement('div');el.id='cu-dialog';el.className='account-payment-overlay';el.style.zIndex='190';el.dataset.run=settlementRunKey();el.innerHTML=`<form class="account-payment-card nr-card" novalidate><h2>Accepted Currencies</h2><fieldset><legend>Accept payments in</legend>${cuChecks('cu',cuPolicy())}</fieldset><p>Changes apply to new bids. Existing bids keep their payment options.</p><p class="settlement-muted">USD/USDC received outside the site must be confirmed by you in Settlement. Your funded treasury GC backs those receipts and gold receipts.</p><p id="cu-error" role="status"></p><div class="uniform-actions"><button type="button" class="btn btn-outline" onclick="cuClose()">Cancel</button><button type="submit" class="btn btn-gold">Save Currencies</button></div></form>`;el.querySelector('form').addEventListener('submit',e=>{e.preventDefault();cuSave();});document.body.append(el);el.querySelector('input').focus();}
function cuClose(){if(!cuSaving)document.getElementById('cu-dialog')?.remove();}
async function cuSave(){const el=document.getElementById('cu-dialog');if(!el||!isRL||cuSaving)return;const error=el.querySelector('#cu-error');let currencies;try{currencies=cuValidate(cuRead('cu'));if(el.dataset.run!==settlementRunKey())throw Error('The run changed. Reopen Currencies.');}catch(e){error.textContent=e.message;return;}cuSaving=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);try{await gsCall('currencies',{runId:el.dataset.run,currencies});el.remove();toast('Accepted currencies saved');}catch(e){error.textContent=e.message||'Could not save currencies';el.querySelectorAll('button').forEach(b=>b.disabled=false);}finally{cuSaving=false;}}
const cuHeader=renderHdr;renderHdr=function(){cuHeader();if(!isRL||archivedSettlementContext)return;const row=document.getElementById('hdr-user');if(!row||row.querySelector('[data-cu-open]'))return;const b=document.createElement('button');b.type='button';b.className='btn btn-outline';b.dataset.cuOpen='';b.textContent='Currencies';b.title='Change accepted payment currencies';b.onclick=cuOpen;row.append(b);};
const cuSetup=gsSetup;gsSetup=function(){const html=cuSetup();if(!html)return html;const t=document.createElement('template');t.innerHTML=html;const check=t.content.querySelector('#gs-gold');if(check){const label=check.closest('label');label.innerHTML='<span>Accepted currencies: '+cuNames(cuPolicy())+'</span><button type="button" class="btn btn-outline" onclick="cuOpen()">Change Currencies</button>';label.classList.remove('sr-check');}t.content.querySelectorAll('p').forEach(p=>{if(p.textContent.startsWith('Gold payments are currently'))p.remove();});return t.innerHTML;};
// The admin-cut/rate form keeps the currency policy; currencies use their own command.
const cuSaveSettings=gsSaveMode;gsSaveMode=async function(){const existing=document.getElementById('gs-gold');if(existing)return cuSaveSettings();const input=document.createElement('input');input.id='gs-gold';input.type='checkbox';input.hidden=true;input.checked=!!cuPolicy().gold;document.body.append(input);try{return await cuSaveSettings();}finally{input.remove();}};
function cuWinningBid(a){return Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>b.amount-a.amount||a.ts-b.ts)[0];}
function cuForItem(a){return cuWinningBid(a)?.acceptedCurrencies||cuPolicy();}
function cuReceiptAmount(a,method){const b=cuWinningBid(a),rate=Number(b?.rateUsdPer1000||runUsdRate());return method==='gold'?(Number(a.currentBid)*1000/rate).toLocaleString(undefined,{maximumFractionDigits:2})+' gold':Number(a.currentBid).toLocaleString(undefined,{maximumFractionDigits:6})+' USD/USDC';}
const cuCoinPay=gsPay;
gsPay=function(id){const a=auctions[id];if(!a||gcWinnerId(a)!==String(accountDiscordId())){toast('Open payment from the winning account.');return;}const c=cuForItem(a);document.getElementById('cu-payment')?.remove();const el=document.createElement('div');el.id='cu-payment';el.className='account-payment-overlay';el.style.zIndex='195';el.innerHTML=`<div class="account-payment-card nr-card"><h2>Pay for ${gcEsc(a.name)}</h2>${c.gc?`<button class="btn btn-green" onclick="cuPayCoin('${a.id}')">Pay ${gcMoney(a.currentBid)} from my balance</button>`:''}${c.gold?`<p>Gold: ${cuReceiptAmount(a,'gold')}. Arrange payment with the raid leader.</p>`:''}${c.usd?`<p>USD/USDC: ${cuReceiptAmount(a,'usd')}. Arrange payment with the raid leader.</p>`:''}<p class="settlement-muted">The leader confirms payments received outside the site.</p><button class="btn btn-outline" onclick="document.getElementById('cu-payment').remove()">Close</button></div>`;document.body.append(el);el.querySelector('button')?.focus();};
function cuPayCoin(id){document.getElementById('cu-payment')?.remove();return cuCoinPay(id);}
function cuRecord(id,method){if(!isRL)return;const a=auctions[id];if(!a)return;gsAction('payWin',{runId:settlementRunKey(),auctionId:id,method,externalReceived:method==='usd',expectedAmount:Number(a.currentBid)},'Confirm you received '+cuReceiptAmount(a,method)+' for '+gcEsc(a.name)+'. This records the external receipt and credits '+gcMoney(a.currentBid)+' to the run pot.');}
function cuRefund(id){if(!isRL)return;const p=settlement.gsPayments?.[id];if(!p)return;gsAction('refundWin',{runId:settlementRunKey(),auctionId:id,goldReturned:p.method==='gold',externalReturned:p.method==='usd'},p.method==='gs'?'Return this purchase payment to the winner?':'Confirm you have returned the '+(p.method==='gold'?'gold':'USD/USDC')+' to the winner. The matching GC will be removed from the run pot.');}
gsCollections=function(){return auctionList().filter(a=>a.status==='sold').map(a=>{const p=settlement.gsPayments?.[a.id],paid=p?.status==='paid',c=cuForItem(a);return `<div class="purchase-collection-card"><div class="purchase-person">${gcEsc(a.name)}<p>${gcEsc(settlementWinner(a))} · ${gsAmount(a.currentBid)}</p></div><div class="purchase-actions">${paid?`<span>Paid (${p.method==='gs'?'GC':p.method==='usd'?'USD/USDC':'Gold'})</span><button class="btn btn-outline btn-sm" onclick="cuRefund('${a.id}')">Refund</button>`:`${c.gc?'<span>Winner can pay GC from their account.</span>':''}${c.gold?`<button class="btn btn-outline btn-sm" onclick="cuRecord('${a.id}','gold')">Record gold received</button>`:''}${c.usd?`<button class="btn btn-outline btn-sm" onclick="cuRecord('${a.id}','usd')">Record USD/USDC received</button>`:''}`}</div></div>`;}).join('');};
const cuDetails=psDetailsHTML;psDetailsHTML=function(){return cuDetails().replace(/>Pay ([^<]+)<\/button>/g,'>Payment options</button>');};
Object.assign(window,{confirmReset,gsPay,gsSaveMode,cuOpen,cuClose,cuPayCoin,cuRecord,cuRefund});

// Production check-in uses server-owned approval and private raid codes.
const gsAttendanceManager=openAttendanceManager;
const attendanceLoads=new Map();
const attendanceRenderBase=renderAttendanceManager;
renderAttendanceManager=function(){
 attendanceRenderBase();
 const overlay=document.getElementById('attendance-overlay'),state=attendanceLoads.get(runId);
 if(!overlay||!state)return;
 const container=overlay.querySelector('.attendance-manager-scroll');if(!container)return;
 const status=document.createElement('div');status.setAttribute('role','status');status.className='settlement-muted';
 status.textContent=state.error?'Could not load the raid code. Please retry.':'Loading raid code…';
 if(state.error){const retry=document.createElement('button');retry.className='btn btn-outline btn-sm';retry.textContent='Retry';retry.onclick=()=>openAttendanceManager();status.append(retry);}
 container.prepend(status);
 container.querySelectorAll('button[onclick*="toggleAttendanceCheckIn"],button[onclick*="copyAttendanceInvite"]').forEach(button=>{button.disabled=true;});
};
openAttendanceManager=function(){
 if(!isRL)return;
 const key=runId;
 if(!key){toast('The run is still loading. Try again in a moment.');return;}
 if(attendanceLoads.get(key)?.pending){gsAttendanceManager();return;}
 const state={pending:true,error:false};attendanceLoads.set(key,state);
 gsAttendanceManager();
 gsCall('attendanceSettings',{runId:key}).then(data=>{
  gsPrivateCodes[key]=data.code;
  if(attendanceLoads.get(key)===state)attendanceLoads.delete(key);
 }).catch(e=>{state.pending=false;state.error=true;toast(e.message||'Could not load attendance');})
 .finally(()=>{if(runId===key&&document.getElementById('attendance-overlay'))renderAttendanceManager();});
};
join=function(){gsVerify();};
Object.assign(window,{openAttendanceManager,join,verifyAttendanceCode,checkInAttendance,leaveAttendance,toggleAttendanceCheckIn});

// Launch mode: leader-confirmed payments and an off-chain GC ledger.
gsHelp=function(){return '<p>GODSPEEDCOIN is tracked here off-chain. The raid leader confirms payments and credits GC manually. Contact the leader to add funds or arrange a payout.</p>';};
gsForm=function(type){if(type==='deposit'){wowConfirm({title:'Add GC',msg:'Arrange payment with the raid leader. Once received, the leader credits your GC balance.',confirmLabel:'Got it',onConfirm:()=>{}});return;}if(type==='configure'||type==='float')return manualGCForm('credit');if(type==='withdraw')return manualGCForm('withdraw');};
function manualGCForm(type,id=''){
 if(type!=='withdraw'&&!isRL)return;
 document.getElementById('manual-gc-form')?.remove();
 const members=Object.entries(gsSnapshot?.members||{}).map(([id,m])=>`<option value="${id}">${settlementEsc(m.name)} · ${id}</option>`).join('');
 const fields=type==='credit'?`<label>Member Discord ID<input id="mg-owner" list="mg-members" required inputmode="numeric"><datalist id="mg-members">${members}</datalist></label><label>GC to credit<input id="mg-amount" type="number" min="0.000001" step="0.000001" required></label><label>Payment reference<input id="mg-reference" maxlength="120" required placeholder="Unique receipt or bookkeeping reference"></label><label>Reason<input id="mg-reason" maxlength="300" required placeholder="Payment received for GC"></label><label><input id="mg-confirm" type="checkbox" required> I received this payment and verified the member and amount.</label>`:type==='withdraw'?`<label>GC to withdraw<input id="mg-amount" type="number" min="0.000001" step="0.000001" required></label><label>Payout instructions<textarea id="mg-details" maxlength="300" required placeholder="How the leader should arrange your payout"></textarea></label>`:`<p>${gsAmount(gsSnapshot?.withdrawals?.[id]?.amount)} to Discord ${settlementEsc(gsSnapshot?.withdrawals?.[id]?.owner||'')}</p><label>Payout reference<input id="mg-reference" maxlength="120" required></label><label><input id="mg-confirm" type="checkbox" required> I sent the payout and verified the recipient and amount.</label>`;
 const el=document.createElement('div');el.id='manual-gc-form';el.className='account-payment-overlay';el.innerHTML=`<form class="account-payment-card"><h2>${type==='credit'?'Credit GC':type==='withdraw'?'Request payout':'Confirm payout sent'}</h2><div class="gs-fields">${fields}</div><div class="uniform-actions"><button type="button" class="btn btn-outline" onclick="document.getElementById('manual-gc-form').remove()">Cancel</button><button class="btn btn-gold" type="submit">${type==='credit'?'Credit GC':type==='withdraw'?'Request payout':'Record payout'}</button></div><p role="status" id="mg-status"></p></form>`;
 document.body.appendChild(el);el.querySelector('form').onsubmit=async e=>{e.preventDefault();if(gsBusy)return;const value=id=>document.getElementById(id)?.value?.trim()||'';const data=type==='credit'?{owner:value('mg-owner'),amount:Number(value('mg-amount')),reference:value('mg-reference'),reason:value('mg-reason'),received:document.getElementById('mg-confirm').checked,runId}:type==='withdraw'?{amount:Number(value('mg-amount')),details:value('mg-details')}:{id,reference:value('mg-reference'),paid:document.getElementById('mg-confirm').checked};gsBusy=true;const button=el.querySelector('button[type=submit]');button.disabled=true;try{await gsCall(type==='credit'?'manualCredit':type==='withdraw'?'manualWithdraw':'manualWithdrawPaid',data);if(document.querySelector('#gs-account-state,#gs-admin-queue,[data-gc-available]'))void gsRefresh();el.remove();toast(type==='credit'?'GC credited':type==='withdraw'?'Payout requested':'Payout recorded');}catch(err){document.getElementById('mg-status').textContent=err.message;}finally{gsBusy=false;button.disabled=false;}};
}
gsAccountState=function(){if(!gsSnapshot)return'Loading account…';const a=gsSnapshot.account;return `<div class="account-stats"><div>Available GC<br><strong>${gsAmount(a.gsBalance)}</strong></div></div><div class="uniform-actions"><button class="btn btn-outline" onclick="gsForm('deposit')">Add GC</button><button class="btn btn-outline" onclick="manualGCForm('withdraw')">Request payout</button>${isRL?'<button class="btn btn-gold" onclick="manualGCForm(\'credit\')">Credit member GC</button>':''}<button class="btn btn-outline" onclick="gsRefresh()">Refresh</button></div><h4>Recent activity</h4>${Object.values(a.ledger||{}).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(e=>`<p>${settlementEsc(e.type.replaceAll('_',' '))} · ${gsAmount(e.gsDelta)} · ${accountDate(e.createdAt)}${e.reason?' · '+settlementEsc(e.reason):''}</p>`).join('')||'<p>No activity yet.</p>'}<h4>Payout requests</h4>${Object.entries(gsSnapshot.withdrawals||{}).filter(([,w])=>w.owner===accountDiscordId()).map(([id,w])=>`<p>${gsAmount(w.amount)} · ${settlementEsc(w.status)} ${w.status==='pending'?`<button class="btn btn-outline btn-sm" onclick="gsAction('withdrawCancel',{id:'${id}'},'Cancel this request and return the GC to your balance?')">Cancel</button>`:''}</p>`).join('')||'<p>None</p>'}`;};
gsAdminQueue=function(){if(!isRL)return'';return `<div class="uniform-actions"><button class="btn btn-gold" onclick="manualGCForm('credit')">Credit member GC</button><button class="btn btn-outline" onclick="gsRefresh()">Refresh</button></div><h4>Payout requests</h4>${Object.entries(gsSnapshot?.withdrawals||{}).filter(([,w])=>w.status==='pending').map(([id,w])=>`<p>${settlementEsc(gsSnapshot?.members?.[w.owner]?.name||w.owner)} · ${gsAmount(w.amount)}<br>${settlementEsc(w.details||'')} <button class="btn btn-outline" onclick="manualGCForm('paid','${id}')">Confirm payout sent</button></p>`).join('')||'<p>None</p>'}<details><summary>Recent manual credits</summary>${Object.values(gsSnapshot?.manualReceipts||{}).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(r=>`<p>${settlementEsc(r.owner)} · ${gsAmount(r.amount)} · ${settlementEsc(r.reference)} · ${accountDate(r.createdAt)}<br>${settlementEsc(r.reason)} · by ${settlementEsc(r.confirmedBy)}</p>`).join('')||'<p>None</p>'}</details>`;};
const manualOldAction=gsAction;gsAction=async function(op,data={},confirmation=''){if(op==='payWin'&&(data.gold===true||['gold','usd'].includes(data.method)))data={...data,externalReceived:true};return manualOldAction(op,data,confirmation);};
Object.assign(window,{gsForm,gsAction,manualGCForm});

openDM=function(){toast('Private messages are unavailable in this release. Use Discord for private messages.');};window.openDM=openDM;

// Queue currency is an input preference. Auction storage remains unchanged.
function queuePreference(){try{return ['gold','gc','usd'].includes(localStorage.getItem('gdkp_queue_currency'))?localStorage.getItem('gdkp_queue_currency'):'gold';}catch{return 'gold';}}
function queueCurrency(){return document.getElementById('queue-currency')?.value||queuePreference();}
function queueToStored(n,c){const rate=Number(runUsdRate());if(!(rate>0))throw Error('Set a valid run exchange rate first');return Math.round((gsContext()?(c==='gold'?n*rate/1000:n):(c==='gold'?n:n*1000/rate))*1e6)/1e6;}
function queueFromStored(n,c){const rate=Number(runUsdRate());return Math.round((gsContext()?(c==='gold'?n*1000/rate:n):(c==='gold'?n:n*rate/1000))*1e6)/1e6;}
function queueRead(id,fallback){const el=document.getElementById(id);const n=el?Number(el.value):fallback;const value=queueToStored(n,queueCurrency());if(!Number.isFinite(value)||value<=0||value>100000000)throw Error('Enter a positive bid amount within the limit');return value;}
function queueLabels(){const c=queueCurrency(),label={gold:'Gold',gc:'GC',usd:'USD'}[c];document.querySelectorAll('[data-queue-unit]').forEach(el=>el.textContent=label);const el=document.getElementById('queue-conversion');if(el)el.textContent='1,000 gold = '+Number(runUsdRate())+' GC = $'+Number(runUsdRate())+' USD. Your selection is remembered.';}
function queueSwitch(c){const select=document.getElementById('queue-currency'),old=select.dataset.previous||queuePreference();for(const id of ['m-start','m-btn1','m-btn2','m-btn3']){const el=document.getElementById(id);if(el&&el.value!=='')el.value=queueFromStored(queueToStored(Number(el.value),old),c);}select.dataset.previous=c;try{localStorage.setItem('gdkp_queue_currency',c);}catch{}queueLabels();uiCaptureQueue();}
const queueBuildOriginal=buildModal;
buildModal=function(...args){const html=queueBuildOriginal(...args),t=document.createElement('template');t.innerHTML=html;const start=t.content.querySelector('#m-start');if(!start)return html;const c=queuePreference();const block=document.createElement('div');block.className='fg';block.innerHTML='<label for="queue-currency">Enter bids in</label><select id="queue-currency" onchange="queueSwitch(this.value)" style="width:100%;padding:.6rem;background:var(--bg-input);color:var(--text-bright);border:1px solid var(--border-gold)">'+[['gold','Gold'],['gc','GC'],['usd','USD']].map(([v,l])=>'<option value="'+v+'" '+(v===c?'selected':'')+'>'+l+'</option>').join('')+'</select><p id="queue-conversion" class="settlement-muted">1,000 gold = '+Number(runUsdRate())+' GC = $'+Number(runUsdRate())+' USD. Your selection is remembered.</p>';block.querySelector('select').dataset.previous=c;start.closest('.three-col').before(block);for(const id of ['m-start','m-btn1','m-btn2','m-btn3']){const el=t.content.querySelector('#'+id);if(el){el.setAttribute('value',queueFromStored(Number(el.getAttribute('value')),c));el.setAttribute('min','0.000001');el.setAttribute('step','any');el.removeAttribute('max');}}const unit={gold:'Gold',gc:'GC',usd:'USD'}[c];start.previousElementSibling.innerHTML='Start bid (<span data-queue-unit>'+unit+'</span>)';const buttons=t.content.querySelector('#m-btn1').closest('.fg');buttons.querySelector('.lbl').innerHTML='Bid increments (<span data-queue-unit>'+unit+'</span>)';buttons.querySelector('span').setAttribute('data-queue-unit','');const each=buttons.querySelector('div[style] > span');if(each){each.textContent=unit;each.setAttribute('data-queue-unit','');}return t.innerHTML;};
for(const name of ['addToQueue','addToQueueAndStart','saveEdit','saveEditAndStart','saveEditAndQueue']){const original=({addToQueue,addToQueueAndStart,saveEdit,saveEditAndStart,saveEditAndQueue})[name];const wrapped=function(...args){try{for(const id of ['m-start','m-btn1','m-btn2','m-btn3'])queueRead(id,1);return original(...args);}catch(e){toast(e.message);}};if(name==='addToQueue')addToQueue=wrapped;if(name==='addToQueueAndStart')addToQueueAndStart=wrapped;if(name==='saveEdit')saveEdit=wrapped;if(name==='saveEditAndStart')saveEditAndStart=wrapped;if(name==='saveEditAndQueue')saveEditAndQueue=wrapped;window[name]=wrapped;}
Object.assign(window,{queueSwitch,previewStartBid});

 
// Gold-first header display; GC follows the current run's acceptance policy.
let headerCurrencyRun=null;
const goldFirstHeader=renderHdr;
renderHdr=function(){
 if(gsContext()){
  const key=settlementRunKey();
  if(headerCurrencyRun!==key){headerCurrencyRun=key;gcGoldView=true;displayCurrency='gold';}
  if(!cuPolicy().gc&&!gcGoldView&&displayCurrency!=='usd'){gcGoldView=true;displayCurrency='gold';}
 }
 goldFirstHeader();
 if(!gsContext())return;
 const el=document.querySelector('#hdr-user .currency-toggle');if(!el)return;
 const gcEnabled=cuPolicy().gc===true;
 el.innerHTML=`<button onclick="setDisplayCurrency('goldunit')" title="Show amounts in gold" aria-label="Show gold" class="${gcGoldView?'active':''}">&#128176;</button><button onclick="setDisplayCurrency('usd')" title="Show dollars" aria-label="Show dollars" class="${!gcGoldView&&displayCurrency==='usd'?'active':''}">$</button><button onclick="setDisplayCurrency('gc')" title="${gcEnabled?'Show Godspeed Coin':'GC is not accepted for this run'}" aria-label="Show Godspeed Coin (GC)" aria-disabled="${!gcEnabled}" ${gcEnabled?'':'disabled'} class="${!gcGoldView&&displayCurrency!=='usd'?'active':''}"><span class="gc-coin-icon" aria-hidden="true">GC</span></button>`;
};
const goldFirstSetCurrency=setDisplayCurrency;
setDisplayCurrency=function(next){
 if(gsContext()&&next==='gc'&&cuPolicy().gc!==true)return;
 return goldFirstSetCurrency(next);
};
Object.assign(window,{renderHdr,setDisplayCurrency});


// Shared progress feedback for server commands and remote dialogs.
let uiLastButton=null,uiLastClick=0,uiProgressId=0;
const uiPendingCommands=new Map(),uiProgressTasks=new Map();
document.addEventListener('click',event=>{uiLastButton=event.target.closest?.('button,[role="button"]')||null;uiLastClick=Date.now();},true);
function uiShowProgress(){
 let box=document.getElementById('ui-request-progress');
 if(!uiProgressTasks.size){box?.remove();return;}
 if(!box){box=document.createElement('div');box.id='ui-request-progress';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:400;background:#19150d;color:#e6c56c;border:1px solid #a78b42;padding:12px 18px;max-width:90vw';document.body.append(box);}
 box.textContent=Array.from(uiProgressTasks.values()).at(-1);
}
function uiProgress(label,work){
 const id=++uiProgressId,button=Date.now()-uiLastClick<1000?uiLastButton:null,disabled=button?.disabled;
 uiProgressTasks.set(id,label);uiShowProgress();
 if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
 const timer=setTimeout(()=>{if(uiProgressTasks.has(id)){uiProgressTasks.set(id,'waiting for the server...');uiShowProgress();}},8000);
 return Promise.resolve().then(work).finally(()=>{clearTimeout(timer);uiProgressTasks.delete(id);if(button){button.disabled=disabled;button.removeAttribute('aria-busy');}uiShowProgress();});
}
const uiCommandOriginal=gsCall;
gsCall=function(op,data={},id){
 if(['snapshot','prepareClaimImage'].includes(op))return uiCommandOriginal(op,data,id);
 const key=JSON.stringify([gsAuth.currentUser?.uid,op,data]);
 if(uiPendingCommands.has(key))return uiPendingCommands.get(key);
 const label=op==='attendanceSettings'?(data.open===true?'Opening check-in…':data.open===false?'Closing check-in…':'Loading raid code…'):({placeBid:'Submitting bid…',payWin:'Recording payment…',creditCut:'Recording payout…',manualCredit:'Recording credit…',manualWithdraw:'Submitting payout request…',manualWithdrawPaid:'Recording payout…',attendanceJoin:'Checking in…',attendanceVerify:'Checking raid code…',attendanceLeave:'Updating attendance…',currencies:'Saving currencies…',mode:'Saving run settings…',lockCuts:'Locking cuts…',refundWin:'Recording refund…'})[op]||'Saving…';
 const task=uiProgress(label,()=>uiCommandOriginal(op,data,id)).catch(error=>{hybridError(error.message||'Could not save. Your changes have not been confirmed.');throw error;}).finally(()=>uiPendingCommands.delete(key));
 uiPendingCommands.set(key,task);return task;
};
const uiCheckinPending=new Map(),uiAttendanceRender=renderAttendanceManager;
renderAttendanceManager=function(){
 uiAttendanceRender();const desired=uiCheckinPending.get(runId);if(desired===undefined)return;
 document.querySelectorAll('#attendance-overlay button[onclick*="toggleAttendanceCheckIn"]').forEach(button=>{button.disabled=true;button.textContent=desired?'Opening…':'Closing…';button.setAttribute('aria-busy','true');});
};
toggleAttendanceCheckIn=async function(open){
 if(!isRL||!runId||uiCheckinPending.has(runId))return;
 const key=runId;uiCheckinPending.set(key,!!open);renderAttendanceManager();
 try{const settings=await gsCall('attendanceSettings',{runId:key,open:!!open});gsPrivateCodes[key]=settings.code;if(runId===key){const {code,...publicSettings}=settings;attendanceSettings={...attendanceSettings,...publicSettings};if(!open)syncSettlementRaiders(true);toast(open?'Check-in opened':'Check-in closed');}}
 catch(error){toast(error.message||'Check-in could not be changed. Please retry.');}
 finally{uiCheckinPending.delete(key);if(runId===key){renderAttendanceManager();refreshPotAndLoot();}}
};
function uiRemoteDialog(original,label){let pending=null;return function(...args){if(pending)return pending;pending=uiProgress(label,()=>original(...args)).finally(()=>{pending=null;});return pending;};}
openArchivedSettlement=uiRemoteDialog(openArchivedSettlement,'Loading archived settlement…');
openArchivedPayoutByCode=uiRemoteDialog(openArchivedPayoutByCode,'Loading archived payout…');
openArchivedPayoutByKey=uiRemoteDialog(openArchivedPayoutByKey,'Loading archived payout…');
openAccountAttachment=uiRemoteDialog(openAccountAttachment,'Loading attachment…');
openCutRequestReview=uiRemoteDialog(openCutRequestReview,'Loading dispute…');
openFeedbackAdmin=uiRemoteDialog(openFeedbackAdmin,'Loading reports…');
openFeedbackAttachment=uiRemoteDialog(openFeedbackAttachment,'Loading screenshot…');
Object.assign(window,{toggleAttendanceCheckIn,openArchivedSettlement,openArchivedPayoutByCode,openArchivedPayoutByKey,openAccountAttachment,openCutRequestReview,openFeedbackAdmin,openFeedbackAttachment});

// Auction input defaults are expressed in the leader's chosen currency.
function auctionDefaultsKey(){return 'gdkp_auction_defaults:'+String(accountDiscordId()||'leader');}
function validAuctionDefaults(d){return d&&['gold','gc','usd'].includes(d.currency)&&Number.isFinite(d.start)&&d.start>0&&d.start<=1e8&&Array.isArray(d.increments)&&d.increments.length===3&&d.increments.every(n=>Number.isFinite(n)&&n>0&&n<=1e8)&&d.increments.every((n,i)=>!i||n>=d.increments[i-1])&&Number.isFinite(d.timer)&&d.timer>=10&&d.timer<=600;}
function auctionDefaults(){let saved;try{saved=JSON.parse(localStorage.getItem(auctionDefaultsKey()));}catch{}return [raidSettings.auctionDefaults,saved].find(validAuctionDefaults)||{currency:'gold',start:1000,increments:[250,500,1000],timer:120};}
function applyAuctionDefaults(d){const select=document.getElementById('queue-currency');if(!select)return;select.value=d.currency;select.dataset.previous=d.currency;for(const [id,value] of Object.entries({'m-start':d.start,'m-btn1':d.increments[0],'m-btn2':d.increments[1],'m-btn3':d.increments[2],'m-timer':d.timer})){const el=document.getElementById(id);if(el)el.value=value;}queueLabels();uiCaptureQueue();}
function openAuctionSettings(){
 if(!isRL||!runId)return;document.getElementById('auction-settings')?.remove();const d=auctionDefaults(),el=document.createElement('div');el.id='auction-settings';el.className='account-payment-overlay';el.style.zIndex='250';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Auction Settings');el.dataset.run=runId;
 el.innerHTML=`<form class="account-payment-card"><h2>Auction Settings</h2><p>Defaults for new items. Existing auctions keep their values.</p><div class="gs-fields"><label>Currency<select name="currency">${[['gold','Gold'],['usd','USD'],['gc','GC']].map(([v,l])=>`<option value="${v}" ${v===d.currency?'selected':''}>${l}</option>`).join('')}</select></label><label>Starting bid<input name="start" type="number" min="0.000001" max="100000000" step="any" value="${d.start}" required></label>${d.increments.map((n,i)=>`<label>Increment ${i+1}<input name="increment${i}" type="number" min="0.000001" max="100000000" step="any" value="${n}" required></label>`).join('')}<label>Timer (seconds)<input name="timer" type="number" min="10" max="600" step="1" value="${d.timer}" required></label></div><p class="settlement-muted">Amounts use the currency selected above. Saved for this run and future runs on this browser.</p><p role="status" id="auction-settings-status"></p><button type="submit" class="btn btn-gold">Save defaults</button> <button type="button" class="btn btn-outline" onclick="document.getElementById('auction-settings').remove()">Close</button></form>`;
 document.body.appendChild(el);el.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),status=el.querySelector('[role=status]');if(button.disabled)return;const values=new FormData(form),next={currency:values.get('currency'),start:Number(values.get('start')),increments:[0,1,2].map(i=>Number(values.get('increment'+i))),timer:Number(values.get('timer'))};if(!validAuctionDefaults(next)){status.textContent='Use positive amounts and increments in ascending order.';return;}if(el.dataset.run!==runId){status.textContent='The run changed. Reopen Auction Settings.';return;}button.disabled=true;status.textContent='Saving…';try{for(const n of [next.start,...next.increments]){const stored=queueToStored(n,next.currency);if(stored<=0||stored>1e8)throw Error('Amounts exceed the supported range at this exchange rate.');}await update(runRef('/settings'),{auctionDefaults:next});if(el.dataset.run===runId){raidSettings.auctionDefaults=next;const draft=uiRead('queue');if(draft){draft.currency=next.currency;draft.fields={...draft.fields,'m-start':String(next.start),'m-btn1':String(next.increments[0]),'m-btn2':String(next.increments[1]),'m-btn3':String(next.increments[2]),'m-timer':String(next.timer)};uiWrite('queue',draft);}if(modal&&!editId)applyAuctionDefaults(next);}let remembered=true;try{localStorage.setItem(auctionDefaultsKey(),JSON.stringify(next));localStorage.setItem('gdkp_queue_currency',next.currency);}catch{remembered=false;}status.textContent=remembered?'Defaults saved.':'Saved for this run. Browser storage is unavailable.';toast('Auction defaults saved');}catch(e){status.textContent=e.message||'Could not save defaults.';}finally{button.disabled=false;}};el.querySelector('select').focus();
}
const defaultsBuildModal=buildModal;
buildModal=function(title,a,...args){const html=defaultsBuildModal(title,a,...args);if(a)return html;const t=document.createElement('template');t.innerHTML=html;const d=auctionDefaults(),select=t.content.querySelector('#queue-currency');if(!select)return html;for(const option of select.options)option.toggleAttribute('selected',option.value===d.currency);select.dataset.previous=d.currency;for(const [id,value] of Object.entries({'m-start':d.start,'m-btn1':d.increments[0],'m-btn2':d.increments[1],'m-btn3':d.increments[2],'m-timer':d.timer})){t.content.querySelector('#'+id)?.setAttribute('value',value);}t.content.querySelectorAll('[data-queue-unit]').forEach(el=>el.textContent={gold:'Gold',usd:'USD',gc:'GC'}[d.currency]);const button=document.createElement('button');button.type='button';button.className='btn btn-outline btn-sm';button.textContent='Auction Settings';button.setAttribute('onclick','openAuctionSettings()');t.content.querySelector('#queue-conversion')?.after(button);return t.innerHTML;};
// A bid does not change balances. Avoid fetching the account ledger after each bid.
const auctionBidPending=new Set();
submitBid=async function(id,val,event){if(!gsContext())return gsOldBid(id,val,event);const key=runId+':'+id;if(auctionBidPending.has(key))return;auctionBidPending.add(key);try{await gsCall('placeBid',{runId,auctionId:id,amount:Number(val)});toast('Bid accepted');}catch(e){toast(e.message||'Bid could not be confirmed.');}finally{auctionBidPending.delete(key);}};
Object.assign(window,{openAuctionSettings,submitBid});

// Live, read-only purchase display. Opening it never changes run/payment state.
let lpView=null;
function lpGroups(data){
 const buyers=new Map();
 for(const [id,a] of Object.entries(data?.auctions||{})){
  if(a.status!=='sold')continue;
  const winner=Object.values(a.bids||{}).filter(b=>!b.retracted).sort((a,b)=>Number(b.amount)-Number(a.amount))[0];
  if(!winner?.bidder)continue;
  const price=Number(a.currentBid);if(!Number.isFinite(price)||price<0)continue;
  const key=String(winner.bidder);let buyer=buyers.get(key);
  if(!buyer){buyer={key,name:String(data.nicks?.[key]||key),total:0,items:[]};buyers.set(key,buyer);}
  buyer.total+=price;buyer.items.push({id,name:String(a.name||'Unnamed item'),price,icon:a.itemIcon,quality:a.quality});
 }
 return [...buyers.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
function lpClose(){const v=lpView;if(!v)return;lpView=null;v.unsub?.();v.connectionUnsub?.();clearInterval(v.monitor);v.root.remove();if(v.popup&&!v.popup.closed)v.popup.close();if(v.opener?.isConnected)v.opener.focus({preventScroll:true});}
function lpStatus(){const v=lpView;if(!v)return;v.status.textContent=v.error?'Live updates unavailable. Close and reopen Purchases.':!v.connected?'Reconnecting. Displayed purchases may be out of date.':!v.data?'Loading purchases…':'Live updates. Keep the main website tab open.';}
function lpRender(){
 const v=lpView;if(!v)return;if(!isRL||!user||settlementRunKey()!==v.runId){lpClose();return;}
 if(!v.data)return;
 const groups=lpGroups(v.data),rows=groups.map(g=>({...g,totalText:displayMoney(g.total),items:g.items.map(i=>({...i,priceText:displayMoney(i.price)}))}));
 const title=String(v.data.settings?.raidTitle||'Current run'),signature=JSON.stringify([title,rows]);if(signature===v.signature)return;v.signature=signature;
 const scroll=v.list.scrollTop,fragment=v.doc.createDocumentFragment();
 for(const [rank,g] of rows.entries()){
  const card=v.doc.createElement('section');card.className='lp-buyer';
  const head=v.doc.createElement('header'),name=v.doc.createElement('h2'),total=v.doc.createElement('strong');name.textContent=(rank+1)+'. '+g.name;total.textContent=g.totalText;head.append(name,total);card.append(head);
  const count=v.doc.createElement('p');count.className='lp-count';count.textContent=g.items.length+' item'+(g.items.length===1?'':'s');card.append(count);
  for(const item of g.items){const row=v.doc.createElement('div');row.className='lp-item';const icon=v.doc.createElement('span');icon.className='lp-icon';if(typeof item.icon==='string'&&/^[a-z0-9_-]+$/i.test(item.icon)){const img=v.doc.createElement('img');img.src=iconUrl(item.icon);img.alt='';img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});icon.append(img);}const label=v.doc.createElement('span');label.className='lp-item-name '+(['legendary','epic','rare','uncommon'].includes(item.quality)?'lp-'+item.quality:'');label.textContent=item.name;const amount=v.doc.createElement('span');amount.className='lp-price';amount.textContent=item.priceText;row.append(icon,label,amount);card.append(row);}fragment.append(card);
 }
 if(!rows.length){const empty=v.doc.createElement('p');empty.className='lp-empty';empty.textContent='No purchases yet. Sold items will appear here automatically.';fragment.append(empty);}
 v.list.replaceChildren(fragment);v.list.scrollTop=scroll;v.heading.textContent=title;
 const count=rows.reduce((n,g)=>n+g.items.length,0),total=groups.reduce((n,g)=>n+g.total,0);v.summary.textContent=rows.length+' buyers · '+count+' items · '+displayMoney(total)+' total';
}
function openPurchases(){
 if(!isRL||!runId||!user)return;
 if(lpView&&lpView.runId===settlementRunKey()&&(!lpView.popup||!lpView.popup.closed)){lpView.popup?.focus();lpView.close.focus();return;}lpClose();
 let popup=null;try{popup=window.open('','godspeed-purchases','popup=yes,width=620,height=850,resizable=yes,scrollbars=yes');if(popup?.closed)popup=null;if(popup){popup.document.title='Purchases | GODSPEED GDKP';popup.document.body.replaceChildren();}}catch{popup=null;}
 const doc=popup?popup.document:document,root=doc.createElement('section');root.className='lp-shell'+(popup?' lp-window':'');root.setAttribute('role','dialog');root.setAttribute('aria-label','Purchases');
 root.innerHTML=`<style>
 .lp-shell{position:fixed;inset:90px 18px 18px auto;width:min(640px,calc(100vw - 36px));z-index:8500;display:flex;flex-direction:column;background:#110f0a;color:#e9dfc7;border:1px solid #8b7331;border-radius:6px;box-shadow:0 15px 55px #000a;font:15px/1.5 system-ui,sans-serif;overflow:hidden;resize:both;min-width:280px;min-height:260px;box-sizing:border-box}
 .lp-shell.lp-window,.lp-shell.lp-expanded{inset:0;width:100%;height:100%;border-radius:0;resize:none}
 .lp-top{flex:none;padding:16px 20px;border-bottom:1px solid #655123;background:#211b10}.lp-topline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.lp-top h1{margin:0 auto 0 0;color:#d9b448;font:26px/1.2 Georgia,serif}.lp-shell button{cursor:pointer;color:#e9d6a5;background:#312719;border:1px solid #8b7331;border-radius:3px;padding:7px 12px;font:14px system-ui}.lp-shell button:focus-visible{outline:2px solid #f8df81;outline-offset:3px}.lp-heading{margin:10px 0 2px;font-weight:600;overflow-wrap:anywhere}.lp-summary,.lp-status{margin:4px 0;font-size:13px;color:#bba779}.lp-status{color:#aaca9b}.lp-list{flex:1;min-height:0;overflow:auto;padding:16px;overscroll-behavior:contain}.lp-buyer{margin:0 0 14px;background:#201a10;border:1px solid #655123;border-radius:4px;padding:14px}.lp-buyer header{display:flex;align-items:baseline;justify-content:space-between;gap:14px}.lp-buyer h2{margin:0;color:#efcf79;font:20px/1.3 Georgia,serif;overflow-wrap:anywhere}.lp-buyer strong{color:#efcf79;white-space:nowrap;font-size:18px}.lp-count{margin:4px 0 8px;color:#bba779;font-size:12px}.lp-item{display:flex;align-items:center;gap:10px;border-top:1px solid #65512366;padding:10px 0}.lp-item-name{flex:1;min-width:0;overflow-wrap:anywhere}.lp-price{white-space:nowrap;color:#e9cd83}.lp-icon{width:30px;height:30px;background:#ffffff08;border-radius:3px;flex:none}.lp-icon img{width:100%;height:100%;border-radius:3px}.lp-epic{color:#c275f3}.lp-legendary{color:#ffad42}.lp-rare{color:#65b5f1}.lp-uncommon{color:#70d071}.lp-empty{padding:24px;color:#bba779;text-align:center}
 @media(max-width:480px){.lp-shell{inset:12px;width:calc(100vw - 24px);resize:none}.lp-buyer{padding:10px}.lp-list{padding:10px}.lp-top{padding:12px}.lp-buyer h2{font-size:18px}.lp-buyer strong{font-size:16px}}
 </style><div class="lp-top"><div class="lp-topline"><h1>Purchases</h1><button type="button" data-expand ${popup?'hidden':''}>Expand</button><button type="button" data-close>Close</button></div><p class="lp-heading"></p><p class="lp-summary"></p><p class="lp-status" role="status"></p></div><div class="lp-list" tabindex="0" aria-label="Purchases by buyer, highest spender first"></div>`;
 const v={runId:settlementRunKey(),doc,root,popup,opener:document.activeElement,heading:root.querySelector('.lp-heading'),summary:root.querySelector('.lp-summary'),status:root.querySelector('.lp-status'),list:root.querySelector('.lp-list'),close:root.querySelector('[data-close]'),connected:false};lpView=v;
 doc.body.append(root);v.close.onclick=lpClose;root.querySelector('[data-expand]').onclick=e=>{const expanded=root.classList.toggle('lp-expanded');e.currentTarget.textContent=expanded?'Restore':'Expand';};root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();lpClose();}});v.close.focus();lpStatus();
 v.unsub=onValue(ref(db,'runs/'+v.runId),snap=>{if(lpView!==v)return;v.data=snap.val()||{};v.error=false;lpRender();lpStatus();},()=>{if(lpView!==v)return;v.error=true;lpStatus();});
 v.connectionUnsub=onValue(ref(db,'.info/connected'),snap=>{if(lpView!==v)return;v.connected=snap.val()===true;lpStatus();});
 v.monitor=setInterval(()=>{if(popup?.closed||!user||!isRL||settlementRunKey()!==v.runId)lpClose();},1000);
}
const lpPotOriginal=buildPotBarHTML;
buildPotBarHTML=function(...args){const html=lpPotOriginal(...args);if(!isRL)return html;const t=document.createElement('template');t.innerHTML=html;t.content.querySelectorAll('[onclick="enterRollout()"],[onclick="openPurchases()"]').forEach(el=>el.remove());const button=document.createElement('button');button.className='btn btn-outline btn-sm';button.textContent='Purchases';button.setAttribute('onclick','openPurchases()');button.title='Live purchases grouped by buyer, highest spender first';const start=t.content.querySelector('[onclick="confirmReset()"]');if(start)start.after(button);else t.content.querySelector('.pot-bar-actions')?.append(button);return t.innerHTML;};
const lpCurrencyOriginal=setDisplayCurrency;setDisplayCurrency=function(...args){const result=lpCurrencyOriginal(...args);lpRender();return result;};
const lpLogoutOriginal=logout;logout=function(...args){lpClose();return lpLogoutOriginal(...args);};
window.addEventListener('pagehide',lpClose);
Object.assign(window,{openPurchases,buildPotBarHTML,setDisplayCurrency,logout});

// Payout methods are chosen by the leader when cuts are locked.
const payoutLabels={gold:'Gold',usd:'USD/USDC',gs:'GC'};
function payoutAllowed(){return settlement.payoutMethods||{gold:settlement.settlementMode==='mixed'&&!!settlement.goldEnabled,usd:false,gc:true};}
function payoutOptions(type,chosen,allowed,disabled=false){return ['gold','usd','gs'].map(method=>{const enabled=allowed[method==='gs'?'gc':method]===true;return `<label class="pm-option ${!enabled||disabled?'pm-disabled':''}"><input type="${type}" name="payout-method" value="${method}" ${chosen.includes(method)?'checked':''} ${!enabled||disabled?'disabled':''}><span>${payoutLabels[method]}</span></label>`;}).join('');}
const payoutStyle=document.createElement('style');payoutStyle.textContent=`.pot-bar-actions>button[onclick="openPurchases()"]{background:#37e56f!important;color:#082712!important;border-color:#73ff9e!important;font-weight:700!important;box-shadow:0 0 12px #37e56f33}.pot-bar-actions>button[onclick="openPurchases()"]:hover{background:#70ff98!important}.pm-options{display:flex;flex-wrap:wrap;gap:12px;border:0;padding:0;margin:16px 0}.pm-option{display:flex;align-items:center;gap:10px;padding:12px 18px;border:1px solid var(--border-gold);border-radius:3px;background:var(--bg-input);color:var(--text-bright);cursor:pointer;font-family:'Cinzel',serif}.pm-option:has(input:checked){border-color:var(--gold);background:#63501855}.pm-option input{appearance:none;width:20px;height:20px;margin:0;border:2px solid #9c843f;border-radius:3px;display:grid;place-content:center;flex:none}.pm-option input:checked{background:#d4ad39;border-color:#f2d979}.pm-option input:checked:after{content:'✓';color:#191406;font:bold 17px sans-serif}.pm-option input:focus-visible{outline:2px solid #fff0a4;outline-offset:4px}.pm-disabled{opacity:.45;cursor:default}`;document.head.append(payoutStyle);
let payoutChoicePending=false;
gsMyPayout=function(){const r=payoutCurrentRaider(),started=!!settlement.payoutStarted,allowed=payoutAllowed(),selected=r?.gsPayoutMethod||(!settlement.payoutMethods?'gs':''),cut=r?Number(r.gsCut??calculateSettlementCuts().cuts[r.key]??0):0;return `<div class="payout-claim"><div class="settlement-section"><h2 class="settlement-section-title">My Payout</h2><p>${r?displayMoney(cut):'Your attendance has not been linked to a cut yet.'}</p><p>${r?.paid?'Payout complete.':!started?'Payouts have not started yet.':payoutChoicePending?'Saving your choice…':selected?'Selected: '+payoutLabels[selected]:'Choose how to receive your payout.'}</p><fieldset class="pm-options" aria-label="Payout method">${payoutOptions('radio',[selected],allowed,!r||!started||!!r.paid||payoutChoicePending)}</fieldset>${r?'<button class="btn btn-outline btn-sm" onclick="openCutRequest()">Dispute Cut</button>':''}</div></div>`;};
let hybridPayoutChoice=null;
const hybridCurrentRaider=payoutCurrentRaider;
payoutCurrentRaider=function(...args){const r=hybridCurrentRaider(...args),p=hybridPayoutChoice;return r&&p&&p.run===settlementRunKey()&&p.owner===accountDiscordId()&&p.key===r.key?{...r,gsPayoutMethod:p.method}:r;};
document.addEventListener('change',async event=>{
 const input=event.target;if(!input.matches('.payout-claim input[name="payout-method"]')||payoutChoicePending)return;
 rememberPayoutFields();const r=payoutCurrentRaider(),key=settlementRunKey(),owner=accountDiscordId();if(!r||!settlement.payoutStarted||r.paid)return;
 const method=input.value;payoutChoicePending=true;hybridPayoutChoice={run:key,owner,key:r.key,method};renderMain();
 try{await gsCall('payoutChoice',{runId:key,raiderKey:r.key,method});if(key===settlementRunKey()&&owner===accountDiscordId()&&settlement.raiders?.[r.key])settlement.raiders[r.key].gsPayoutMethod=method;toast('Payout choice saved');}
 catch(e){hybridError(e.message||'Could not save payout choice');}
 finally{payoutChoicePending=false;hybridPayoutChoice=null;if(key===settlementRunKey()&&owner===accountDiscordId())renderMain();}
});
toggleSettlementLock=function(){if(!gsContext()||settlement.payoutStarted)return gsOldLock();if(!isRL)return;document.getElementById('pm-start')?.remove();const el=document.createElement('div');el.id='pm-start';el.className='account-payment-overlay';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Start Payouts');const key=settlementRunKey(),policy=cuPolicy(),chosen=['gold','usd','gs'].filter(m=>policy[m==='gs'?'gc':m]);el.innerHTML=`<form class="account-payment-card"><h2>Start Payouts</h2><p>Choose the methods raiders may receive. Each raider selects one.</p><fieldset class="pm-options" aria-label="Allowed payout methods">${payoutOptions('checkbox',chosen,{gold:true,usd:true,gc:true})}</fieldset><p>Starting payouts locks the cuts and records the admin cut.</p><p role="status"></p><button type="submit" class="btn btn-gold">Start Payouts</button> <button type="button" class="btn btn-outline" onclick="document.getElementById('pm-start').remove()">Cancel</button></form>`;document.body.append(el);el.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=el.querySelector('[type=submit]'),status=el.querySelector('[role=status]');if(button.disabled)return;const selected=[...el.querySelectorAll('input:checked')].map(i=>i.value);if(!selected.length){status.textContent='Select at least one payout method.';return;}if(key!==settlementRunKey()){status.textContent='The run changed. Reopen Start Payouts.';return;}button.disabled=true;status.textContent='Starting payouts…';try{await gsCall('lockCuts',{runId:key,payoutMethods:{gold:selected.includes('gold'),usd:selected.includes('usd'),gc:selected.includes('gs')}});el.remove();toast('Payouts started');}catch(err){status.textContent=err.message||'Could not start payouts';button.disabled=false;}};el.querySelector('input')?.focus();};
const pmQueueOriginal=gsPayoutQueue;gsPayoutQueue=function(...args){const t=document.createElement('template');t.innerHTML=pmQueueOriginal(...args);for(const button of t.content.querySelectorAll('button[onclick]')){const match=button.getAttribute('onclick').match(/^gsCredit\('([^']+)'\)$/);if(!match)continue;const r=settlement.raiders?.[match[1]],method=r?.gsPayoutMethod||(!settlement.payoutMethods?'gs':null);button.textContent=method==='gold'?'Record gold paid':method==='usd'?'Record USD/USDC paid':method==='gs'?'Credit GC':'Awaiting payout choice';if(!method)button.disabled=true;}return t.innerHTML;};
gsCredit=async function(key,immediate=false){const confirm=message=>immediate?'':message;const r=settlement.raiders?.[key],method=r?.gsPayoutMethod||(!settlement.payoutMethods?'gs':null);if(!r||!method){toast('The raider must choose a payout method first.');return;}const data={runId:settlementRunKey(),raiderKey:key,expectedMethod:method,expectedAmount:Number((Number(r.gsCut||0)-Number(r.gsCredited||0)).toFixed(6))};if(method==='gold'){try{const rate=settlement.payoutUsdPer1000,quote=typeof rate==='number'&&Number.isFinite(rate)&&rate>0?{gold:data.expectedAmount*1000/rate,payoutRate:rate}:await gsCall('quoteGold',data);gsAction('creditCut',{...data,goldDelivered:true,expectedGold:quote.gold,expectedPayoutRate:quote.payoutRate},confirm('Confirm you delivered '+quote.gold.toFixed(2)+' gold to '+r.name+'?'));}catch(e){toast(e.message);}}else if(method==='usd'){gsAction('creditCut',{...data,externalPaid:true},confirm('Confirm you already paid $'+data.expectedAmount.toFixed(2)+' USD/USDC to '+r.name+' outside the site?'));}else gsAction('creditCut',data,confirm('Credit '+gcMoney(data.expectedAmount)+' to '+r.name+'?'));};
Object.assign(window,{toggleSettlementLock,gsCredit});

// GC management uses the existing audited credit and payout operations.
function gcMemberPaused(){return !isRL&&gsSnapshot?.config?.memberGCEnabled!==true;}
function gcPausedOperation(op,data={}){return ['manualWithdraw','withdraw','withdrawCancel','depositCancel','depositRequest','submitHash'].includes(op)||(op==='payWin'&&!data.gold&&(!data.method||data.method==='gs'))||(op==='payoutChoice'&&data.method==='gs');}
let gmLoading=false,gmQuery='',gmSnapshot=null;
const gmStyle=document.createElement('style');gmStyle.textContent=`.gc-paused{opacity:.4!important;filter:grayscale(1);cursor:not-allowed!important}#gc-manager{z-index:220}#gc-manager .account-payment-card{width:min(1100px,95vw);max-height:90vh;overflow:auto}#gc-manager h2{margin-top:0}.gm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}.gm-stat{border:1px solid var(--border-gold);padding:12px;background:var(--bg-input)}.gm-stat strong{display:block;color:var(--gold);font-size:22px}.gm-table{overflow:auto;margin:12px 0 24px}.gm-table table{width:100%;border-collapse:collapse}.gm-table th,.gm-table td{text-align:left;padding:10px;border-bottom:1px solid var(--border-gold);vertical-align:top}.gm-table th{color:var(--gold)}.gm-table small{display:block;overflow-wrap:anywhere}.gm-table button{white-space:nowrap}#gm-search{width:100%;padding:10px;box-sizing:border-box;background:var(--bg-input);color:var(--text-bright);border:1px solid var(--border-gold)}`;document.head.append(gmStyle);
function gmClose(){document.getElementById('gc-manager')?.remove();gmSnapshot=null;gmQuery='';}
function gmRows(headers,rows){return '<div class="gm-table"><table><thead><tr>'+headers.map(h=>'<th>'+settlementEsc(h)+'</th>').join('')+'</tr></thead><tbody>'+ (rows.join('')||'<tr><td colspan="'+headers.length+'">None</td></tr>')+'</tbody></table></div>';}
function gmRender(){const box=document.getElementById('gm-content');if(!box)return;if(!isRL){gmClose();return;}const s=gmSnapshot;if(!s){box.textContent='Load the dashboard to see balances and activity.';return;}const members=s.members||{},credits=Object.entries(s.manualReceipts||{}).sort((a,b)=>b[1].createdAt-a[1].createdAt),requests=Object.entries(s.withdrawals||{}).sort((a,b)=>b[1].createdAt-a[1].createdAt),pending=requests.filter(([,w])=>w.status==='pending'),esc=settlementEsc,name=id=>members[id]?.name||id,match=(...parts)=>parts.join(' ').toLowerCase().includes(gmQuery.toLowerCase()),date=n=>n?esc(accountDate(n)):'',memberTotal=Object.entries(members).filter(([id])=>id!==s.config?.houseId).reduce((n,[,m])=>n+Number(m.balance||0),0);
 const summary=`<div class="gm-stats"><div class="gm-stat">Member balances<strong>${gsAmount(memberTotal)}</strong></div><div class="gm-stat">Treasury balance<strong>${gsAmount(s.house?.balance||0)}</strong></div><div class="gm-stat">Pending cash-outs<strong>${gsAmount(pending.reduce((n,[,w])=>n+Number(w.amount||0),0))}</strong></div></div><p>${s.config?.memberGCEnabled===false?'Member GC actions are paused. Leader management remains available.':s.config?.memberGCEnabled===true?'Member GC actions are enabled.':'Deploy the backend update to enforce the member GC pause.'}</p>`;
 const people=Object.entries(members).filter(([id,m])=>match(id,m.name)).sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([id,m])=>`<tr><td>${esc(m.name)}<small>${esc(id)}</small></td><td>${gsAmount(m.balance||0)}</td><td><button class="btn btn-outline btn-sm" data-gm-credit="${esc(id)}">Credit GC</button></td></tr>`);
 const cashouts=pending.filter(([id,w])=>match(id,w.owner,name(w.owner),w.details)).map(([id,w])=>`<tr><td>${esc(name(w.owner))}<small>${esc(w.owner)}</small></td><td>${gsAmount(w.amount)}</td><td>${esc(w.details||'')}<small>${date(w.createdAt)}</small></td><td><button class="btn btn-outline btn-sm" data-gm-paid="${esc(id)}">Confirm payout sent</button> <button class="btn btn-outline btn-sm" data-gm-cancel="${esc(id)}">Cancel & return GC</button></td></tr>`);
 const receiptRows=credits.filter(([id,r])=>match(id,r.owner,name(r.owner),r.reference,r.reason,r.runId)).map(([id,r])=>`<tr><td>${date(r.createdAt)}</td><td>${esc(name(r.owner))}<small>${esc(r.owner)}</small></td><td>${gsAmount(r.amount)}</td><td>${esc(r.reference)}<small>${esc(r.reason)}</small></td><td>${esc(r.runId||'')}<small>By ${esc(r.confirmedBy||'')}</small></td></tr>`);
 const payoutRows=requests.filter(([id,r])=>match(id,r.owner,name(r.owner),r.reference,r.status)).map(([id,r])=>`<tr><td>${date(r.paidAt||r.createdAt)}</td><td>${esc(name(r.owner))}</td><td>${gsAmount(r.amount)}</td><td>${esc(r.status)}</td><td>${esc(r.reference||'')}</td></tr>`);
 const activity=(s.memberActivity||[]).filter(r=>match(r.owner,name(r.owner),r.type,r.reason,r.runId)).map(r=>`<tr><td>${date(r.createdAt)}</td><td>${esc(name(r.owner))}</td><td>${esc(String(r.type||'').replaceAll('_',' '))}</td><td>${gsAmount(r.amount||0)}</td><td>${esc(r.reason||'')}<small>${esc(r.runId||'')}</small></td></tr>`);
 box.innerHTML=summary+'<h3>Pending payouts</h3>'+gmRows(['Member','Amount','Instructions','Action'],cashouts)+'<h3>Member balances</h3>'+gmRows(['Member','Available GC','Action'],people)+'<h3>Manual credit history</h3>'+gmRows(['Date','Member','GC','Reference / reason','Run / credited by'],receiptRows)+'<h3>Payout request history</h3>'+gmRows(['Date','Member','GC','Status','Reference'],payoutRows)+'<h3>Recent balance activity</h3><p class="settlement-muted">Latest 200 account entries.</p>'+gmRows(['Date','Member','Activity','GC change','Reason / run'],activity);
}
async function gmLoad(){if(!isRL)return;const el=document.getElementById('gc-manager');if(!el||el.dataset.loading==='true')return;el.dataset.loading='true';const status=el.querySelector('[role=status]');status.textContent='Refreshing…';try{const snapshot=await gsCall('snapshot');if(!isRL||document.getElementById('gc-manager')!==el)return;gmSnapshot=snapshot;gsSnapshot=snapshot;gmRender();status.textContent='Updated '+new Date().toLocaleTimeString();}catch(e){if(el.isConnected)status.textContent=e.message||'Could not load GC records.';}finally{el.dataset.loading='false';}}
function gmCredit(id=''){if(!isRL)return;manualGCForm('credit');const input=document.getElementById('mg-owner');if(input){input.value=id;input.focus();}}
function gmExport(){if(!isRL||!gmSnapshot)return;const s=gmSnapshot,rows=[['Record','ID','Member Discord ID','GC','Status','Reference','Reason','Timestamp','Run']];for(const [id,r] of Object.entries(s.manualReceipts||{}))rows.push(['Credit',id,r.owner,r.amount,'recorded',r.reference,r.reason,r.createdAt,r.runId]);for(const [id,w] of Object.entries(s.withdrawals||{}))rows.push(['Payout request',id,w.owner,w.amount,w.status,w.reference||'',w.details||'',w.paidAt||w.createdAt,'']);for(const r of s.memberActivity||[])rows.push(['Ledger '+r.type,r.id,r.owner,r.amount,'recorded','',r.reason,r.createdAt,r.runId]);const cell=v=>{let value=String(v??'');if(typeof v!=='number'&&/^[=+\-@\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';};const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='godspeed-gc-records-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function openGCManager(){if(!isRL)return;const existing=document.getElementById('gc-manager');if(existing){existing.querySelector('button').focus();return;}const el=document.createElement('div');el.id='gc-manager';el.className='account-payment-overlay';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Manage GC');el.innerHTML='<div class="account-payment-card"><h2>Manage GC</h2><div class="uniform-actions"><button class="btn btn-gold" data-gm-credit="">Credit member GC</button><button class="btn btn-outline" onclick="gmLoad()">Refresh</button><button class="btn btn-outline" onclick="gmExport()">Export CSV</button><button class="btn btn-outline" onclick="gmClose()">Close</button></div><p role="status"></p><label for="gm-search">Search member, Discord ID, receipt or run</label><input id="gm-search" type="search"><div id="gm-content"></div></div>';el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-gm-credit'))gmCredit(b.dataset.gmCredit);if(b.hasAttribute('data-gm-paid'))manualGCForm('paid',b.dataset.gmPaid);if(b.hasAttribute('data-gm-cancel'))gsAction('withdrawCancel',{id:b.dataset.gmCancel},'Cancel this payout request and return its reserved GC to the member?');});el.querySelector('input').oninput=e=>{gmQuery=e.target.value;gmRender();};el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();gmClose();}});document.body.append(el);gmRender();void gmLoad();}
const gmFormOriginal=manualGCForm;manualGCForm=function(type,...args){if(gcMemberPaused()){toast('GC actions are temporarily unavailable.');return;}const result=gmFormOriginal(type,...args);const el=document.getElementById('manual-gc-form');if(el)el.style.zIndex='240';return result;};
const gmGsForm=gsForm;gsForm=function(type){if(isRL&&['deposit','configure','float'].includes(type))return openGCManager();if(gcMemberPaused()){toast('GC actions are temporarily unavailable.');return;}return gmGsForm(type);};
const gmCall=gsCall;gsCall=async function(op,data={},id){if(gcMemberPaused()&&gcPausedOperation(op,data))throw Error('GC actions are temporarily unavailable.');const result=await gmCall(op,data,id);if(isRL&&['manualCredit','manualWithdrawPaid','withdrawCancel','creditCut','refundWin'].includes(op)&&document.getElementById('gc-manager'))void gmLoad();return result;};
const gmAccount=gsAccountState;gsAccountState=function(){const t=document.createElement('template');t.innerHTML=gmAccount();if(isRL){const b=t.content.querySelector('[onclick="gsForm(\'deposit\')"]');if(b){b.textContent='Manage GC';b.setAttribute('onclick','openGCManager()');}}else if(gcMemberPaused()){for(const b of t.content.querySelectorAll('button'))if(b.getAttribute('onclick')!=='gsRefresh()'){b.disabled=true;b.classList.add('gc-paused');b.title='GC actions are temporarily unavailable';}t.content.append(document.createTextNode('GC actions are temporarily unavailable.'));}return t.innerHTML;};
const gmPanel=renderPanel;renderPanel=function(...args){const result=gmPanel(...args);if(isRL&&panelTab==='raiders'){const body=document.getElementById('side-panel-body');if(body&&!body.querySelector('[data-gm-open]')){const b=document.createElement('button');b.className='btn btn-gold';b.dataset.gmOpen='';b.textContent='Manage GC';b.onclick=openGCManager;body.prepend(b);}}return result;};
const gmPayoutOptions=payoutOptions;payoutOptions=function(type,chosen,allowed,...args){return gmPayoutOptions(type,chosen,gcMemberPaused()?{...allowed,gc:false}:allowed,...args);};
function gmDisableButtons(){if(!gcMemberPaused())return;for(const b of document.querySelectorAll('button[onclick]')){const action=b.getAttribute('onclick');if(/^(gsPay\(|gsForm\('deposit'|manualGCForm\('withdraw'|setDisplayCurrency\('gc'|gsAction\('withdrawCancel')/.test(action)){b.disabled=true;b.classList.add('gc-paused');b.title='GC actions are temporarily unavailable';}}}
let gmFrame=0;new MutationObserver(()=>{if(!gmFrame)gmFrame=requestAnimationFrame(()=>{gmFrame=0;gmDisableButtons();});}).observe(document.body,{childList:true,subtree:true});
const gmCurrency=setDisplayCurrency;setDisplayCurrency=function(next){if(next==='gc'&&gcMemberPaused())return;return gmCurrency(next);};
const gmLogout=logout;logout=function(...args){gmClose();return gmLogout(...args);};
Object.assign(window,{openGCManager,gmClose,gmLoad,gmExport,gmCredit,manualGCForm,gsForm,renderPanel,setDisplayCurrency,logout});

// Account layout and editable account copy.
const accountCopyFields=[
 ['account_title','My Account'],['account_subtitle','Characters, raid activity, and settings'],
 ['account_gc_title','GC Balance'],['account_gc_available','Available GC'],
 ['account_gc_manage','Manage GC'],['account_gc_add','Add GC'],['account_gc_request','Request payout'],
 ['account_gc_credit','Credit member GC'],['account_refresh','Refresh'],
 ['account_gc_activity','Recent activity'],['account_gc_empty','No activity yet.'],
 ['account_gc_requests','Payout requests'],['account_gc_no_requests','None'],['account_gc_note',''],
 ['account_run','Current Run'],['account_attending','Attending As'],['account_bids','Auctions Bid'],
 ['account_wins','Wins / Spend'],['account_payout','Raid Payout'],['account_characters','Saved Characters'],
 ['account_add_label','Add character'],['account_character_placeholder','Character name'],['account_add_button','Add'],
 ['account_character_note','Your default character is selected automatically during check-in.'],
 ['account_history','Past Activity'],['account_sound','Sound'],['account_sound_effects','Sound effects'],
 ['account_sound_note','Bid sounds and warnings'],['account_help','Help'],['account_feedback','Bug or Feature Request']
];
SITE_COPY_FIELDS.push(['My Account',accountCopyFields]);
Object.assign(SITE_COPY_LABELS,Object.fromEntries(accountCopyFields.map(([key,label])=>[key,label||'Optional GC note (leave blank to hide)'])));
function accountCopy(key){return siteCopy(key,accountCopyFields.find(f=>f[0]===key)?.[1]||'');}
const accountPolishStyle=document.createElement('style');accountPolishStyle.textContent=`
 #user-settings-overlay .account-overlay-card{padding:28px;max-height:92vh;overflow:auto;scrollbar-gutter:stable}
 #user-settings-overlay .user-settings-wrap{display:flex;flex-direction:column;gap:24px}
 #user-settings-overlay .user-settings-sec{margin:0;min-width:0}
 #user-settings-overlay .user-settings-sec-label{margin-bottom:16px;padding-bottom:10px}
 #user-settings-overlay .account-stats{gap:14px}
 #user-settings-overlay .account-stat{padding:16px}
 #user-settings-overlay .account-character-list{display:grid;gap:12px;margin-bottom:20px}
 #user-settings-overlay .field-action-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px!important;align-items:end!important;margin:16px 0}
 #user-settings-overlay .field-action-row .fg{margin:0!important;min-width:0}
 #user-settings-overlay .field-action-row input{box-sizing:border-box;height:50px;min-height:50px;width:100%;margin:0}
 #user-settings-overlay .field-action-row>.btn{box-sizing:border-box;height:50px;min-height:50px;width:auto;min-width:92px;margin:0;align-self:end}
 #user-settings-overlay .uniform-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px!important;margin:18px 0;align-items:stretch!important}
 #user-settings-overlay .uniform-actions>.btn{width:100%;min-height:48px;white-space:normal;overflow-wrap:anywhere}
 #user-settings-overlay .account-gc-details{padding:14px 0;border-top:1px solid var(--border-gold);line-height:1.6}
 #user-settings-overlay .account-gc-details summary{cursor:pointer;color:var(--gold-light);padding:4px 0}
 #user-settings-overlay .account-gc-details p{margin:12px 0;overflow-wrap:anywhere}
 #user-settings-overlay .account-gc-note{margin:16px 0 0;line-height:1.6}
 #site-text-manager .fg{margin-bottom:22px}
 @media(max-width:520px){#user-settings-overlay .account-overlay-card{padding:18px}#user-settings-overlay .uniform-actions{grid-template-columns:1fr}}
`;document.head.appendChild(accountPolishStyle);
const accountPolishState=gsAccountState;
gsAccountState=function(){
 const t=document.createElement('template');t.innerHTML=accountPolishState();
 const headings=[...t.content.querySelectorAll('h4')];
 for(const h of headings){const details=document.createElement('details');details.className='account-gc-details';const summary=document.createElement('summary');summary.innerHTML=accountCopy(h.textContent==='Recent activity'?'account_gc_activity':'account_gc_requests');details.append(summary);h.before(details);let node=h.nextSibling;while(node&&node.nodeName!=='H4'){const next=node.nextSibling;details.append(node);node=next;}h.remove();}
 const labelKeys={'Manage GC':'account_gc_manage','Add GC':'account_gc_add','Request payout':'account_gc_request','Credit member GC':'account_gc_credit','Refresh':'account_refresh','No activity yet.':'account_gc_empty','None':'account_gc_no_requests'};
 for(const el of t.content.querySelectorAll('button,p')){const key=labelKeys[el.textContent.trim()];if(key)el.innerHTML=accountCopy(key);}
 const balance=t.content.querySelector('.account-stats>div');if(balance&&balance.firstChild?.nodeType===3){const span=document.createElement('span');span.innerHTML=accountCopy('account_gc_available');balance.firstChild.replaceWith(span);}
 return t.innerHTML;
};
gsAccountSection=function(){const note=siteText('account_gc_note','');return `<div class="user-settings-sec"><div class="user-settings-sec-label">${accountCopy('account_gc_title')}</div>${gsAuth.currentUser?'<div id="gs-account-state">'+gsAccountState()+'</div>':'<p>Verify your Discord identity to access your account.</p><button class="btn btn-outline btn-sm" onclick="gsVerify()">Verify Discord</button>'}${note?'<p class="account-gc-note">'+accountCopy('account_gc_note')+'</p>':''}</div>`;};
const accountPolishOpen=openUserSettings;
openUserSettings=function(){const result=accountPolishOpen();const root=document.getElementById('user-settings-overlay');if(!root)return result;
 const keys=new Map(accountCopyFields.filter(([key])=>!key.startsWith('account_gc_')).map(([key,label])=>[label,key]));
 for(const el of root.querySelectorAll('div,button')){if(el.children.length)continue;const key=keys.get(el.textContent.trim());if(key)el.innerHTML=accountCopy(key);}
 const input=root.querySelector('#account-character-input');if(input){input.placeholder=siteText('account_character_placeholder','Character name');input.setAttribute('aria-label',siteText('account_add_label','Add character'));}
 return result;
};window.openUserSettings=openUserSettings;
// Blank values remove custom wording, restoring defaults or hiding the optional note.
saveSiteTextManager=async function(){if(!isRL||!runId)return;const manager=document.getElementById('site-text-manager'),button=document.getElementById('site-text-save-button'),status=document.getElementById('site-text-save-status');if(!manager||button?.disabled)return;const writes={},now=Date.now();manager.querySelectorAll('[data-site-text-key]').forEach(input=>{const text=String(input.value||'').trim().slice(0,500);writes[input.dataset.siteTextKey]=text?{text,updatedAt:now,updatedBy:user||'Raid Leader'}:null;});if(button){button.disabled=true;button.textContent='Saving...';}if(status)status.textContent='Saving changes';try{await update(runRef('/siteContent'),writes);siteContent={...siteContent,...writes};if(status)status.textContent='All changes saved';toast('All site text saved');}catch(error){if(status)status.textContent='Save failed. Try again.';toast('Could not save site text');console.error('Site text save failed',error);}finally{if(button){button.disabled=false;button.textContent='Save All';}}};window.saveSiteTextManager=saveSiteTextManager;

// Mutator field alignment only.
const settlementUiStyle=document.createElement('style');settlementUiStyle.textContent=`
.mutator-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,600px),1fr));gap:16px}
.mutator-card{grid-template-columns:18px minmax(140px,1fr) 100px 110px auto;align-items:start;gap:12px;padding:16px}
.mutator-card .fg{margin:0!important;min-width:0}
.mutator-card .lbl{height:18px;line-height:18px;margin:0 0 8px!important}
.mutator-card input{box-sizing:border-box;width:100%!important;height:48px;font-size:16px!important;padding:8px!important;min-width:0}
.mutator-card-info>input{margin-top:26px}
.mutator-card-rule{margin-top:8px;line-height:1.4}
.mutator-card>.mutator-mini,.mutator-card>.mutator-drag-handle{margin-top:26px;align-self:start}
.settlement-toolbar:has(#mutator-name){align-items:end!important;gap:12px!important}
.settlement-toolbar:has(#mutator-name) .fg{margin:0!important}
.settlement-toolbar:has(#mutator-name) input,.settlement-toolbar:has(#mutator-name)>.btn{height:48px;box-sizing:border-box;margin:0}
@media(max-width:650px){.mutator-card{grid-template-columns:18px minmax(0,1fr) minmax(80px,100px) minmax(85px,110px)}.mutator-card>.mutator-mini{grid-column:2/-1;margin-top:0}.mutator-card-info>input{font-size:14px!important}}
@media(max-width:430px){.mutator-card{grid-template-columns:18px 1fr 1fr}.mutator-card-info{grid-column:2/-1}.mutator-card-info>input{margin-top:0}.mutator-card>.fg:nth-child(3){grid-column:2}.mutator-card>.mutator-drag-handle{margin-top:12px}}
`;document.head.append(settlementUiStyle);

// Raid Tools: record external receipts through the authoritative payment operation.
const rtLegacyMarkAllPaid=markAllPaid,rtLegacyTogglePaid=togglePaid,rtLegacyOverlayPaid=togglePaidFromOverlay;
function rtRecordPurchases(ids){
 if(!isRL)return;
 const key=settlementRunKey(),items=[...new Set(ids)].map(id=>auctions[id]&&({...auctions[id],id})).filter(a=>a?.status==='sold'&&settlement.gsPayments?.[a.id]?.status!=='paid');
 if(!items.length){toast('No unpaid purchases selected');return;}
 document.getElementById('rt-receipts')?.remove();
 const el=document.createElement('div');el.id='rt-receipts';el.className='account-payment-overlay';el.style.zIndex='250';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Record payment');
 el.innerHTML='<form class="account-payment-card"><h2>Record payment</h2><p>Choose the currency received for each purchase.</p><div data-receipt-items></div><label style="display:flex;gap:12px;margin:20px 0"><input type="checkbox" required style="width:18px">I received the payments listed above.</label><p role="status" aria-live="polite"></p><div class="uniform-actions"><button type="submit" class="btn btn-green">Mark Paid</button><button type="button" data-cancel class="btn btn-outline">Cancel</button></div></form>';
 const fields=new Map();for(const a of items){const row=document.createElement('label');row.style.cssText='display:grid;gap:10px;margin:18px 0';const name=document.createElement('span');name.textContent=a.name;const select=document.createElement('select');select.required=true;select.setAttribute('aria-label','Payment currency for '+a.name);const policy=cuForItem(a);for(const method of ['gold','usd'])if(policy[method]){const option=document.createElement('option');option.value=method;option.textContent=(method==='gold'?'Gold':'USD/USDC')+' · '+cuReceiptAmount(a,method);select.append(option);}if(!select.options.length){const o=document.createElement('option');o.value='';o.textContent='Winner must pay GC from their account';select.append(o);}row.append(name,select);el.querySelector('[data-receipt-items]').append(row);fields.set(a.id,select);}
 document.body.append(el);const cancel=el.querySelector('[data-cancel]');cancel.onclick=()=>el.remove();let saving=false;const completed=new Set();
 el.querySelector('form').onsubmit=async event=>{event.preventDefault();if(saving)return;const status=el.querySelector('[role=status]'),button=el.querySelector('[type=submit]');if(key!==settlementRunKey()){status.textContent='The run changed. Close this window and try again.';return;}if([...fields.values()].some(s=>!s.value)){status.textContent='GC purchases must be paid by the winning member.';return;}saving=true;button.disabled=true;cancel.disabled=true;let count=completed.size;try{for(const a of items){if(completed.has(a.id))continue;if(key!==settlementRunKey())throw Error('The run changed. Remaining purchases were not recorded.');const method=fields.get(a.id).value;status.textContent='Recording payment '+(count+1)+' of '+items.length+'…';await gsCall('payWin',{runId:key,auctionId:a.id,method,externalReceived:true,expectedAmount:Number(a.currentBid)});completed.add(a.id);count++;fields.get(a.id).disabled=true;}status.textContent='Payments recorded';toast(count+' purchase'+(count===1?'':'s')+' marked paid');el.remove();if(panelOpen)renderPanel();}catch(error){status.textContent=count+' of '+items.length+' recorded. '+(error.message||'Payment could not be recorded.');}finally{saving=false;button.disabled=false;cancel.disabled=false;}};
}
markAllPaid=function(ids){if(!gsContext())return rtLegacyMarkAllPaid(ids);return rtRecordPurchases(ids);};
togglePaid=function(id){if(!gsContext())return rtLegacyTogglePaid(id);if(!isRL)return;const paid=settlement.gsPayments?.[id]?.status==='paid';if(panelOpen)renderPanel();return paid?cuRefund(id):rtRecordPurchases([id]);};
togglePaidFromOverlay=function(id,button){if(!gsContext())return rtLegacyOverlayPaid(id,button);return rtRecordPurchases([id]);};
Object.assign(window,{markAllPaid,togglePaid,togglePaidFromOverlay});

const settlementUiTogglePaid=togglePaid;
togglePaid=function(id){
 if(!isRL||!gsContext())return settlementUiTogglePaid(id);
 const a=auctions[id];if(!a||a.status!=='sold')return;
 if(settlement.gsPayments?.[id]?.status==='paid')return cuRefund(id);
 if(settlement.payoutStarted){toast('Collections are locked after payouts start');return;}
 document.getElementById('leader-receipt-choice')?.remove();const key=settlementRunKey(),policy=cuForItem(a),el=document.createElement('div');el.id='leader-receipt-choice';el.className='account-payment-overlay';el.style.zIndex='250';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Record payment received');
 el.innerHTML='<div class="account-payment-card"><h2>Record payment received</h2><p data-item></p><div class="uniform-actions" data-methods></div><p data-note></p><button type="button" class="btn btn-outline" data-close>Close</button></div>';el.querySelector('[data-item]').textContent=a.name;
 for(const method of ['gold','usd'])if(policy[method]){const button=document.createElement('button');button.type='button';button.className='btn btn-green';button.textContent='Record '+(method==='gold'?'Gold':'USD/USDC')+' received: '+cuReceiptAmount(a,method);button.onclick=()=>{if(key!==settlementRunKey()){toast('The run changed. Reopen the purchase.');return;}el.remove();cuRecord(id,method);};el.querySelector('[data-methods]').append(button);}
 el.querySelector('[data-note]').textContent=policy.gc?'GC payments are made from the winning member’s account.':'';el.querySelector('[data-close]').onclick=()=>el.remove();document.body.append(el);
};window.togglePaid=togglePaid;

// Surface pending receipts/payouts immediately and coalesce identical clicks.
const paymentPendingCalls=new Map(),paymentPendingOriginal=gsCall;
gsCall=function(op,data={},id){
 if(!['payWin','refundWin','creditCut','quoteGold'].includes(op))return paymentPendingOriginal(op,data,id);
 const key=JSON.stringify([accountDiscordId(),op,data]);if(paymentPendingCalls.has(key))return paymentPendingCalls.get(key);
 let notice=document.getElementById('payment-save-status');if(!notice){notice=document.createElement('div');notice.id='payment-save-status';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#211d12;color:#f1d475;border:1px solid #c9a84c;padding:14px 22px;pointer-events:none';document.body.append(notice);}notice.textContent=op==='quoteGold'?'Preparing payout…':'Saving payment…';
 const work=Promise.resolve().then(()=>paymentPendingOriginal(op,data,id)).finally(()=>{paymentPendingCalls.delete(key);if(!paymentPendingCalls.size)document.getElementById('payment-save-status')?.remove();});paymentPendingCalls.set(key,work);return work;
};

const settlementUiCutCell=settlementCutCellHTML;
settlementCutCellHTML=function(r,calc=calculateSettlementCuts()){
 if(settlement.payoutStarted)return settlementUiCutCell(r,calc);
 const cut=effectiveRaiderCut(r,calc),adjustment=cutAdjustmentTotal(r);
 return displayMoney(cut)+(adjustment?'<div class="settlement-muted">'+(adjustment>0?'+':'')+displayMoney(Math.abs(adjustment))+' adjusted</div>':'');
};
const settlementUiRender=renderSettlement;
renderSettlement=function(...args){const html=settlementUiRender(...args);if(settlement.payoutStarted)return html;const t=document.createElement('template');t.innerHTML=html;const calc=calculateSettlementCuts();for(const r of settlementRaiders()){const cell=[...t.content.querySelectorAll('[id^="settlement-cut-"]')].find(el=>el.id==='settlement-cut-'+r.key);if(cell)cell.innerHTML=settlementCutCellHTML(r,calc);}return t.innerHTML;};

const rtStableRenderPanel=renderPanel;
renderPanel=function(...args){const body=document.getElementById('side-panel-body'),top=body?.scrollTop||0,left=body?.scrollLeft||0;const result=rtStableRenderPanel(...args);if(body){body.scrollTop=top;body.scrollLeft=left;}return result;};
const rtStableStyle=document.createElement('style');rtStableStyle.textContent='#side-panel{transition-property:transform,opacity!important}#side-panel .side-panel-body{overflow-anchor:none;scroll-behavior:auto;scrollbar-gutter:stable}#side-panel .raider-item img{width:20px;height:20px;min-width:20px}#rt-receipts .account-payment-card{max-height:88vh;overflow:auto}';document.head.append(rtStableStyle);

// Reports use the report-specific permissions; screenshots remain optional.
let feedbackSending=false;
submitFeedbackSafe=async function(){
 if(feedbackSending)return;
 const note=String(document.getElementById('feedback-text')?.value||'').trim().slice(0,800);
 if(!note){toast('Add the report details');return;}
 const overlay=document.getElementById('feedback-overlay');if(!overlay)return;
 let status=overlay.querySelector('[data-feedback-status]');if(!status){status=document.createElement('p');status.dataset.feedbackStatus='';status.setAttribute('role','status');overlay.querySelector('.account-payment-card').append(status);}
 const button=overlay.querySelector('button[onclick="submitFeedback()"]');feedbackSending=true;if(button)button.disabled=true;status.textContent='Sending report…';
 try{const id=push(ref(db,'siteFeedback')).key,record={type:document.getElementById('feedback-type')?.value||'other',note,status:'open',createdAt:Date.now(),runId:runId||'',raidTitle:raidSettings.raidTitle||'',discordId:accountDiscordId()||'',discordName:discordUser?.username||'',displayName:discordUser?.displayName||user||'',character:currentRaiderName()||user||'',hasAttachment:!!feedbackDraftImage};const writes={};writes['siteFeedback/'+id]=record;if(feedbackDraftImage)writes['siteFeedbackAttachments/'+id]=feedbackDraftImage;await update(ref(db),writes);if(document.getElementById('feedback-overlay')===overlay)closeFeedbackForm();toast('Report sent');}catch(error){status.textContent='Report was not sent. '+(error.code==='PERMISSION_DENIED'?'Please sign in again and retry.':error.message||'Please retry.');}finally{feedbackSending=false;if(button)button.disabled=false;}
};window.submitFeedback=submitFeedbackSafe;

function archivedLootMoney(amount,data){
 const s=data.settlement||{},rate=Number(s.usdPer1000||s.usdcPer1000)||10,coin=['coin','mixed'].includes(s.settlementMode),n=Number(amount)||0;
 const mode=gsContext()?(gcGoldView?'gold':displayCurrency==='usd'?'usd':'gc'):(displayCurrency==='usd'?'usd':'gold');
 const dollars=coin?n:n*rate/1000;
 return mode==='gold'?goldText(coin?n*1000/rate:n):mode==='usd'?usdText(dollars):gsAmount(dollars);
}

startLootDisplayFromArchive=function(runKey){
  if(isRL){
    localStorage.setItem('gdkp_archive_display',runKey);
    update(runRef(),{archiveDisplay:runKey});
  }
  get(ref(db,'runs/'+runKey)).then(snap=>{
    const data=snap.val()||{};
    const sold=Object.values(data.auctions||{}).filter(a=>a.status==='sold').sort((a,b)=>(b.currentBid||0)-(a.currentBid||0));
    if(!sold.length){toast('No sold items in this run');return;}
    document.getElementById('loot-display-overlay')?.remove();
    const title=data.settings?.raidTitle||'Archive';
    const qualityColors={legendary:'#ff8000',epic:'#a335ee',rare:'#0070dd',uncommon:'#1eff00',common:'#fff'};
    const pot=sold.reduce((s,a)=>s+(a.currentBid||0),0);

    // Build category tabs
    const cats=['All',...[...new Set(sold.map(a=>a.category||'Other'))].sort()];
    let activeCat='All';

    const buildCards=(filtered)=>filtered.map((a,i)=>{
      const bids=Object.values(a.bids||{}).filter(b=>!b.retracted).sort((x,y)=>y.amount-x.amount);
      const winner=displayName(bids[0]?.bidder)||'Unknown';
      const qColor=qualityColors[a.quality]||'#c590ff';
      const icon=getIconImg(a.itemId,a.itemIcon,80);
      const wowAttrs=a.itemId?`href="https://www.wowhead.com/tbc/item=${a.itemId}" data-wowhead="item=${a.itemId}&domain=tbc" target="_blank"`:'href="#"';
      return`<a class="loot-card" ${wowAttrs} style="animation-delay:${i*18}ms;">
        <div class="loot-card-icon-wrap">${icon}</div>
        <div class="loot-card-name" style="color:${qColor};">${a.name}</div>
        <div class="loot-card-footer">
          <div class="loot-card-winner">${winner}</div>
          <div class="loot-card-price">${archivedLootMoney(a.currentBid||0,data)}</div>
        </div>
      </a>`;
    }).join('');

    const buildCatBtns=(active)=>cats.map(c=>{
      const count=c==='All'?sold.length:sold.filter(a=>(a.category||'Other')===c).length;
      return`<button class="loot-display-cat-btn${c===active?' active':''}" onclick="_archiveSwitchCat('${c}')">${c} <span style="opacity:.6;">(${count})</span></button>`;
    }).join('');

    const overlay=document.createElement('div');
    overlay.id='loot-display-overlay';
    overlay.className='loot-display-overlay';

    const rebuildGrid=(cat)=>{
      const filtered=cat==='All'?sold:sold.filter(a=>(a.category||'Other')===cat);
      const body=overlay.querySelector('.loot-display-grid-inner');
      if(body)body.innerHTML=filtered.length?buildCards(filtered):`<div style="grid-column:1/-1;text-align:center;font-family:'Cinzel',serif;font-size:.82rem;color:rgba(201,168,76,0.3);padding:4rem 0;">No items in this category</div>`;
      overlay.querySelectorAll('.loot-display-cat-btn').forEach(b=>{b.classList.toggle('active',b.textContent.startsWith(cat));});
    };
    window._archiveSwitchCat=(cat)=>{activeCat=cat;rebuildGrid(cat);};

    // Build sidebar from archive items
    const allItems=Object.values(data.auctions||{}).sort((a,b)=>{const o={open:0,queued:1,sold:2,expired:3};return(o[a.status]??4)-(o[b.status]??4);});
    const statusColors={open:'#60cc80',queued:'#c9a84c',sold:'rgba(201,168,76,0.4)',expired:'#cc6060'};
    const statusLabels={open:'Live',queued:'Queue',sold:'Sold',expired:'Exp'};
    const statusBadgeCss={open:'background:rgba(96,204,128,0.15);color:#60cc80;border:1px solid rgba(96,204,128,0.3);',queued:'background:rgba(201,168,76,0.12);color:#c9a84c;border:1px solid rgba(201,168,76,0.25);',sold:'background:rgba(201,168,76,0.08);color:rgba(201,168,76,0.5);border:1px solid rgba(201,168,76,0.15);',expired:'background:rgba(200,60,60,0.12);color:#cc6060;border:1px solid rgba(200,60,60,0.25);'};
    const sidebarItems=allItems.map(a=>{
      const wowAttrs=a.itemId?`href="https://www.wowhead.com/tbc/item=${a.itemId}" data-wowhead="item=${a.itemId}&domain=tbc" target="_blank"`:'href="#"';
      return`<div class="loot-sidebar-item"><a ${wowAttrs} style="display:flex;align-items:center;gap:.4rem;text-decoration:none;width:100%;"><div class="loot-sidebar-dot" style="background:${statusColors[a.status]||'#555'};"></div><span class="loot-sidebar-name">${a.name}</span><span class="loot-sidebar-badge" style="${statusBadgeCss[a.status]||''}">${statusLabels[a.status]||'?'}</span></a></div>`;
    }).join('');

    const initialFiltered=sold;
    overlay.innerHTML=`
      <div class="loot-display-sidebar">
        <div class="loot-display-sidebar-hdr">Run Loot (${allItems.length})</div>
        ${sidebarItems}
      </div>
      <div class="loot-display-content">
        <div class="loot-display-hdr">
          <div style="flex:1;">
            <div class="loot-display-title">${title}</div>
            <div class="loot-display-sub">${sold.length} item${sold.length!==1?'s':''} sold${isRL?` &middot; ${archivedLootMoney(pot,data)} pot`:''}</div>
          </div>
          ${isRL?`<button class="loot-display-close-btn" onclick="closeArchiveDisplay()">&#x2715; Close</button>`:''}        </div>
        ${cats.length>1?`<div class="loot-display-cats">${buildCatBtns('All')}</div>`:''}
        <div class="loot-display-body">
          <div class="loot-display-grid-inner">
            ${buildCards(initialFiltered)}
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    if(window.$WowheadPower)window.$WowheadPower.refreshLinks();
    sold.forEach(a=>{if(!a.itemIcon&&a.itemId)fetchIcon(a.itemId);});
  }).catch(error=>{console.error('Archive display failed',error);toast('Could not open the archived loot display');});
}
;
window.startLootDisplayFromArchive=startLootDisplayFromArchive;

// Remember the current view even when it was opened through another control.
const viewTabs=new Set(['active','queued','sold','expired','payout','settlement']);
let viewRestorePending=true;
function rememberRunView(){if(!user||!runId||archivedSettlementContext||!viewTabs.has(tab))return;try{sessionStorage.setItem('gs_run_view',JSON.stringify({run:runId,owner:accountDiscordId(),tab}));localStorage.setItem('gdkp_tab',tab);}catch{}}
const viewSetTab=setTab;setTab=function(t){const result=viewSetTab(t);if(tab===t){viewRestorePending=false;rememberRunView();}return result;};window.setTab=setTab;
const viewRenderMain=renderMain;renderMain=function(...args){if(viewRestorePending&&user&&runId&&!archivedSettlementContext){let saved;try{saved=JSON.parse(sessionStorage.getItem('gs_run_view')||'null');}catch{}if(saved&&saved.run===runId&&saved.owner===accountDiscordId()&&viewTabs.has(saved.tab)){if(saved.tab!=='settlement'||isRL){tab=saved.tab;viewRestorePending=false;}}else viewRestorePending=false;}return viewRenderMain(...args);};
window.addEventListener('pagehide',rememberRunView);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')rememberRunView();});
let adminCutDraft=null;
const adminCutCalculator=calculateSettlementCutsFrom;
calculateSettlementCutsFrom=function(state=settlement){if(isRL&&gsContext()&&!state.payoutStarted&&adminCutDraft?.run===settlementRunKey())return adminCutCalculator({...state,managementCut:adminCutDraft.value,gsCutLines:{lead:adminCutDraft.value,treasury:0,risk:0,handling:0},gsTaper:false});return adminCutCalculator(state);};
function previewAdminCut(value){if(!isRL||settlement.payoutStarted)return;const n=Number(value),box=document.getElementById('ac-result');if(value.trim()===''||!Number.isFinite(n)||n<0||n>100){if(box)box.textContent='Enter an admin cut from 0 to 100%.';return;}adminCutDraft={run:settlementRunKey(),value:n};refreshSettlementCutCells();const calc=calculateSettlementCuts();if(box)box.textContent='Preview: admin '+displayMoney(calc.managementCut)+'. Save Settings to apply for everyone.';}
window.previewAdminCut=previewAdminCut;
const workflowSetup=gsSetup;gsSetup=function(){const t=document.createElement('template');t.innerHTML=workflowSetup();const cut=t.content.querySelector('#ac-percent'),rate=t.content.querySelector('#gs-rate'),locked=!!settlement.payoutStarted||!!archivedSettlementContext;if(cut){cut.disabled=locked;cut.setAttribute('oninput','previewAdminCut(this.value)');if(adminCutDraft?.run===settlementRunKey())cut.value=adminCutDraft.value;if(adminCutDraft?.run===settlementRunKey())cut.setAttribute('value',adminCutDraft.value);}if(rate)rate.disabled=locked||Object.values(auctions||{}).some(a=>a.status==='sold'||Object.keys(a.bids||{}).length);const note=t.content.querySelector('#ac-result');if(note)note.textContent=locked?'Payouts have fixed cuts. Use individual cut adjustments for corrections.':'Admin cut stays editable until payouts start. Changes preview immediately; Save Settings applies them. Exchange rates lock when bidding begins.';t.content.querySelectorAll('[onclick="gsSaveMode()"]').forEach(b=>b.disabled=locked);return t.innerHTML;};
gsSaveMode=async function(){if(!isRL||gsBusy)return;const key=settlementRunKey(),cut=Number(gsField('ac-percent')),rate=Number(gsField('gs-rate')),box=document.getElementById('ac-result');if(!Number.isFinite(cut)||cut<0||cut>100||!Number.isFinite(rate)||rate<=0){if(box)box.textContent='Enter a cut from 0 to 100% and a positive rate.';return;}gsBusy=true;if(box)box.textContent='Saving settings…';try{await gsCall('runSettings',{runId:key,adminCut:cut,rate});adminCutDraft=null;if(box)box.textContent='Settings saved';toast('Run settings saved');refreshSettlementCutCells();}catch(e){if(box)box.textContent=/Unknown GS operation/.test(e.message)?'The settings backend update must be deployed before saving. Your preview has not been saved.':e.message||'Could not save settings';}finally{gsBusy=false;}};window.gsSaveMode=gsSaveMode;
const workflowSettlement=renderSettlement;renderSettlement=function(...args){const t=document.createElement('template');t.innerHTML=workflowSettlement(...args);for(const collection of t.content.querySelectorAll('.purchase-collection-list'))collection.closest('.settlement-section')?.remove();const grid=t.content.querySelector('.mutator-grid'),section=grid?.closest('details');if(section){section.open=true;const summary=t.content.querySelector('.settlement-summary');if(summary)summary.after(section);}return t.innerHTML;};
// Purchases actions use the existing leader receipt dialog and update with paid state.
const workflowPurchases=lpRender;lpRender=function(){const result=workflowPurchases(),v=lpView;if(!v||!v.data||!isRL)return result;const groups=lpGroups(v.data);[...v.list.querySelectorAll('.lp-buyer')].forEach((card,index)=>{const group=groups[index];if(!group)return;[...card.querySelectorAll('.lp-item')].forEach((row,i)=>{const item=group.items[i];if(!item)return;const id=item.id||item.auctionId;if(!id)return;let button=row.querySelector('[data-payment-action]');if(!button){button=v.doc.createElement('button');button.dataset.paymentAction='';button.type='button';row.append(button);}const paid=v.data.settlement?.gsPayments?.[id]?.status==='paid'||!!v.data.auctions?.[id]?.paid;button.textContent=paid?'Paid':'Mark Paid';button.disabled=paid;button.onclick=()=>{if(!isRL||v.runId!==settlementRunKey())return;window.focus();togglePaid(id);};});});return result;};

// Raider adjustments are entered in the selected display currency.
function adjustmentDisplayUnit(){const coin=gsContext(),rate=Number(runUsdRate());if(!Number.isFinite(rate)||rate<=0)throw Error('Invalid exchange rate');return coin?(gcGoldView?{label:'Gold',factor:1000/rate}:displayCurrency==='usd'?{label:'USD/USDC',factor:1}:{label:'GC',factor:1}):(displayCurrency==='usd'?{label:'USD/USDC',factor:rate/1000}:{label:'Gold',factor:1});}
function adjustCurrencyValue(input){
 const value=input.value.trim(),n=value===''?0:Number(value),factor=Number(input.dataset.adjustFactor);
 if(!Number.isFinite(n)||!Number.isFinite(factor)||factor<=0){toast('Enter a valid adjustment amount');throw Error('Invalid adjustment');}
 if(value===input.dataset.adjustInitial)return Number(input.dataset.adjustStored);
 return Math.round(n/factor*1e6)/1e6;
}
window.adjustCurrencyValue=adjustCurrencyValue;
const adjustmentCurrencyRender=renderSettlement;
renderSettlement=function(...args){const html=adjustmentCurrencyRender(...args),t=document.createElement('template');t.innerHTML=html;const unit=adjustmentDisplayUnit();for(const input of t.content.querySelectorAll('input[onchange]')){const action=input.getAttribute('onchange');if(!action.startsWith('saveRaiderField(')||!action.includes("'adjustGold'"))continue;const stored=Number(input.getAttribute('value')||0),shown=stored===0?'':String(Math.round(stored*unit.factor*1e6)/1e6);input.setAttribute('value',shown);input.setAttribute('step','any');input.setAttribute('aria-label','Adjust '+unit.label);input.dataset.adjustStored=String(stored);input.dataset.adjustFactor=String(unit.factor);input.dataset.adjustInitial=shown;input.setAttribute('onchange',action.replace('this.value','adjustCurrencyValue(this)'));const cell=input.closest('td'),table=input.closest('table');if(cell&&table){const header=table.querySelector('thead tr')?.children[cell.cellIndex];if(header)header.textContent='Adjust '+unit.label;}}return t.innerHTML;};


// Payout views share the selected currency; completed gold uses recorded delivery.
function payoutDisplayAmount(r,n){
 if(!gsContext())return displayMoney(n);
 if(!gcGoldView)return displayCurrency==='usd'?usdText(Number(n)):gsAmount(n);
 const events=Object.values(r?.payoutEvents||{}).filter(e=>e.type==='paid');
 const goldPaid=events.filter(e=>e.method==='gold').reduce((v,e)=>v+Number(e.goldAmount||0),0);
 const paid=Number(r?.gsCredited||0),rate=Number(settlement.payoutUsdPer1000||runUsdRate());
 const amount=r?.paid&&events.length&&events.every(e=>e.method==='gold')&&Number(n)===paid?goldPaid:Number(n)*1000/rate;
 return Number(amount).toLocaleString(undefined,{maximumFractionDigits:2})+'g';
}
payoutAmountText=function(r,n,method){return gsContext()?payoutDisplayAmount(r,n):gsOldPayoutText(r,n,method);};
settlementCutCellHTML=function(r,calc=calculateSettlementCuts()){
 const cut=effectiveRaiderCut(r,calc),adjustment=cutAdjustmentTotal(r);
 return payoutDisplayAmount(r,cut)+(adjustment?'<div class="settlement-muted">'+(adjustment>0?'+':'')+payoutDisplayAmount(null,Math.abs(adjustment))+' adjusted</div>':'');
};
let payoutRateSaving=false;
async function savePayoutRate(){
 if(!isRL||payoutRateSaving)return;
 const input=document.getElementById('payout-exchange-rate'),status=document.getElementById('payout-rate-status'),rate=Number(input?.value),key=settlementRunKey();
 if(!Number.isFinite(rate)||rate<=0){status.textContent='Enter a positive exchange rate.';return;}
 payoutRateSaving=true;const button=document.getElementById('payout-rate-save');button.disabled=true;status.textContent='Saving payout rate…';
 try{await gsCall('payoutRate',{runId:key,rate,expectedRate:settlement.payoutUsdPer1000??null});status.textContent='Payout rate saved';toast('Payout rate saved');}
 catch(e){status.textContent=/Unknown GS operation/.test(e.message)?'Deploy the payout backend update to enable this setting.':e.message||'Could not save rate';}
 finally{payoutRateSaving=false;button.disabled=false;}
}
const currencyMutatorAdd=addSettlementMutator;
addSettlementMutator=async function(){
 const input=document.getElementById('mutator-flat');if(!input)return currencyMutatorAdd();
 const displayed=input.value;
 try{input.value=String(adjustCurrencyValue(input));return await currencyMutatorAdd();}
 finally{if(input.isConnected&&input.value!=='')input.value=displayed;}
};
const payoutCurrencyRender=renderSettlement;
renderSettlement=function(...args){
 const t=document.createElement('template');t.innerHTML=payoutCurrencyRender(...args);
 const unit=adjustmentDisplayUnit(),calc=calculateSettlementCuts();
 for(const r of settlementRaiders()){
  const cell=[...t.content.querySelectorAll('[id^="settlement-cut-"]')].find(e=>e.id==='settlement-cut-'+r.key);
  if(cell)cell.innerHTML=settlementCutCellHTML(r,calc);
 }
 for(const input of t.content.querySelectorAll('input[onchange],#mutator-flat')){
  const action=input.getAttribute('onchange')||'';
  if(input.id!=='mutator-flat'&&!(action.startsWith('saveSettlementMutatorField(')&&action.includes("'flat'")))continue;
  const stored=Number(input.getAttribute('value')||0),shown=input.id==='mutator-flat'?'':String(Math.round(stored*unit.factor*1e6)/1e6);
  input.setAttribute('value',shown);input.setAttribute('step','any');
  input.dataset.adjustStored=String(stored);input.dataset.adjustFactor=String(unit.factor);input.dataset.adjustInitial=shown;
  input.setAttribute('aria-label','Flat '+unit.label);
  const label=input.closest('.fg')?.querySelector('.lbl');if(label)label.textContent=(input.id==='mutator-flat'?'Flat ':'')+unit.label;
  if(action)input.setAttribute('onchange',action.replace('this.value','adjustCurrencyValue(this)'));
 }
 if(isRL&&gsContext()){
  const section=document.createElement('section');section.className='settlement-section';section.id='payout-rate-settings';
  section.innerHTML='<h3 class="settlement-section-title">Payout exchange rate</h3><label for="payout-exchange-rate">USD/USDC per 1,000 gold</label><div class="uniform-actions" style="margin:14px 0"><input id="payout-exchange-rate" type="number" min="0.000001" step="any" value="'+Number(settlement.payoutUsdPer1000||runUsdRate())+'"><button id="payout-rate-save" class="btn btn-gold" onclick="savePayoutRate()">Save payout rate</button></div><p class="settlement-muted">Applies to unpaid gold payouts, including late claims. Completed payments retain their recorded amounts.</p><p id="payout-rate-status" role="status"></p>';
  const queue=t.content.querySelector('#payout-queue');if(queue)queue.before(section);else t.content.append(section);
 }
 return t.innerHTML;
};
gsAdjust=function(key){
 const unit=adjustmentDisplayUnit();if(gsContext()&&gcGoldView&&settlement.payoutUsdPer1000)unit.factor=1000/settlement.payoutUsdPer1000;
 wowConfirm({title:'Modify Cut',msg:'Enter a signed '+unit.label+' amount followed by a reason. The adjustment applies to this raider.',confirmLabel:'Continue',input:{type:'text',placeholder:'250 Bonus',errorMsg:'Enter amount and reason'},onConfirm:v=>{
  const [raw,...words]=v.trim().split(/\s+/),n=Number(raw),reason=words.join(' ');
  if(!Number.isFinite(n)||!n||!reason){toast('Enter an amount and reason');return;}
  gsAction('adjustCut',{runId:settlementRunKey(),raiderKey:key,amount:Math.round(n/unit.factor*1e6)/1e6,reason},'Apply this adjustment to the selected cut?');
 }});
};
gsMyPayout=function(){
 const r=payoutCurrentRaider(),started=!!settlement.payoutStarted,selected=r?.gsPayoutMethod||(!settlement.payoutMethods?'gs':''),cut=r?Number(r.gsCut??calculateSettlementCuts().cuts[r.key]??0):0;
 return '<div class="payout-claim"><section class="settlement-section payout-garden"><div class="payout-garden-content"><h2 class="settlement-section-title">My Payout</h2>'+(r?.paid?'<h3>Your cut has arrived</h3>':'')+'<p class="payout-garden-amount">'+(r?payoutDisplayAmount(r,cut):'Your attendance has not been linked to a cut yet.')+'</p><p>'+(r?.paid?'Payout complete. Thank you for joining the run.':!started?'Payouts have not started yet.':payoutChoicePending?'Saving your choice…':selected?'Selected: '+payoutLabels[selected]:'Choose how to receive your payout.')+'</p><fieldset class="pm-options" aria-label="Payout method">'+payoutOptions('radio',[selected],payoutAllowed(),!r||!started||!!r.paid||payoutChoicePending)+'</fieldset>'+(r?'<button class="btn btn-outline btn-sm" onclick="openCutRequest()">Dispute Cut</button>':'')+'</div></section></div>';
};
const payoutGardenStyle=document.createElement('style');
payoutGardenStyle.textContent='.payout-garden{position:relative;isolation:isolate;overflow:hidden;min-height:280px;padding:32px!important;background:linear-gradient(115deg,#092a1c,#124c30 70%,#0b3523)!important;border:1px solid #528e51!important}.payout-garden-content{position:relative;z-index:1;max-width:760px}.payout-garden .settlement-section-title{color:#c8e8a1}.payout-garden h3{font:26px Georgia,serif;color:#e5f4c9;margin:18px 0}.payout-garden-amount{font:38px Georgia,serif;color:#ffe39a;margin:18px 0}.payout-garden p{line-height:1.6}.payout-garden .pm-options{margin:24px 0;gap:16px}.payout-garden .pm-option{background:#102f22e8}.payout-garden .btn{background:#123b29}.payout-gold-art{position:absolute;width:min(45%,420px);right:16px;bottom:-6px;opacity:.23;pointer-events:none;z-index:0}@media(max-width:600px){.payout-garden{padding:22px!important}.payout-gold-art{width:75%;opacity:.12}.payout-garden-amount{font-size:32px}}';
document.head.append(payoutGardenStyle);
Object.assign(window,{savePayoutRate,addSettlementMutator,gsAdjust,gsMyPayout,renderSettlement});

// Center the payout content while retaining the existing green background.
payoutGardenStyle.textContent+=' .payout-garden{display:flex;align-items:center;justify-content:center;text-align:center}.payout-garden-content{width:100%;margin-inline:auto}.payout-garden .pm-options{justify-content:center}.payout-garden .pm-option{justify-content:center}';



// Claims are ready only after submission of the required destination and proof.
function gcClaimCategory(r,state=settlement){
 const s=r.submission||{},method=r.gsPayoutMethod,submitted=s.method==='usdc'?'usd':s.method;
 if(['pending','open','reopened'].includes(r.cutRequest?.status))return 'dispute';
 if(r.paid&&Number(r.gsCredited||0)>=Number(r.gsCut||0))return 'paid';
 if(s.status==='correction')return 'correction';
 const allowed=state.payoutMethods||{gc:true,gold:state.settlementMode==='mixed'&&!!state.goldEnabled,usd:false};
 if(!s.submittedAt||s.status==='draft'||method!==submitted||!allowed[method==='gs'?'gc':method])return 'unclaimed';
 if(method==='gold'&&s.seller&&s.item&&payoutSafeImage(s.imageData))return 'gold';
 if(method==='usd'&&validEthAddress(s.walletAddress||''))return 'usdc';
 return method==='gs'?'gs':'unclaimed';
}
const claimStatusOriginal=payoutStatusLabel,claimCategoryOriginal=payoutQueueCategory;
payoutStatusLabel=function(r,calc){
 if(!gsContext())return claimStatusOriginal(r,calc);
 const category=gcClaimCategory(r);
 return ({paid:['Paid','ok'],dispute:['Dispute pending','due'],correction:['Correction needed','due'],gold:['Purchase ready','ready'],usdc:['USDC ready','ready'],gs:['GC ready','ready']})[category]||[payoutClaimExpired(r)?'Claim expired':'No claim',payoutClaimExpired(r)?'due':'warn'];
};
payoutQueueCategory=function(r,calc){if(!gsContext())return claimCategoryOriginal(r,calc);const c=gcClaimCategory(r);return ['gold','usdc','gs'].includes(c)?'ready':c;};
collectSettlementTasks=function(runs,currentKey){
 const out=gsOldTasks(runs,currentKey).filter(e=>!['coin','mixed'].includes(runs?.[e.key]?.settlement?.settlementMode));
 for(const [key,run] of Object.entries(runs||{})){
  const state=run?.settlement;if(!state||run.deleted||run.deletedAt||!['coin','mixed'].includes(state.settlementMode))continue;
  for(const [raiderKey,r] of Object.entries(state.raiders||{})){
   if(!r)continue;
   const category=gcClaimCategory(r,state),due=Math.max(0,Number(r.gsCut||0)-Number(r.gsCredited||0));
   if(category!=='dispute'&&category!=='paid'&&(!state.payoutStarted||due<=0))continue;
   const rate=Number(r.paidRateUsdPer1000||state.payoutUsdPer1000||state.usdPer1000||state.usdcPer1000||10),value=category==='paid'?Number(r.gsCredited||0):due;
   const method=r.gsPayoutMethod||r.submission?.method;
   const recordedGold=category==='paid'?Object.values(r.payoutEvents||{}).filter(e=>e.type==='paid'&&e.method==='gold').reduce((sum,e)=>sum+Number(e.goldAmount||0),0):0;
   const amount=method==='gold'?(recordedGold||value*1000/rate).toLocaleString(undefined,{maximumFractionDigits:2})+'g':method==='gs'?gsAmount(value):method==='usd'||method==='usdc'?value.toFixed(2)+' USDC':usdText(value)+' · method not chosen';
   out.push({key,raiderKey,name:r.name||raiderKey,title:run.settings?.raidTitle||'Untitled Run',date:run.createdAt||run.archivedAt||0,archived:!!run.archived,category,amount,sortAmount:value,note:category==='dispute'?r.cutRequest?.note||'':r.submission?.correctionNote||'',hasProof:!!r.submission?.imageData||!!r.cutRequest?.hasAttachment});
  }
 }
 for(const e of out){
  const state=runs[e.key].settlement,r=state.raiders[e.raiderKey];
  const submission=r.submission||{};e.submittedAt=Number(submission.submittedAt||0);e.seller=submission.seller||'';e.item=submission.item||'';e.walletAddress=submission.walletAddress||'';e.imageData=payoutSafeImage(submission.imageData);
  e.claimUpdatedAt=Number(r.submission?.updatedAt||r.submission?.submittedAt||0);
  const base=Number(state.claimDeadline)||(Number(state.payoutStartedAt)||0)+Math.max(1,Number(state.claimWindowHours)||48)*3600000;
  e.deadline=state.payoutStarted?Math.max(base,Number(r.claimExtensionUntil)||0):0;
  e.expired=!!e.deadline&&e.category!=='paid'&&!r.paid&&!r.submission?.submittedAt&&Date.now()>e.deadline;
  if(e.sortAmount===undefined){
   const adjustments=Object.values(r.cutAdjustments||{}).filter(a=>a&&!a.reversedAt).reduce((n,a)=>n+(Number(a.amount)||0),0);
   const cut=Math.max(0,Math.floor(Number(r.lockedCut||0)+adjustments)),paid=Number(r.paidAmount||(r.paid?cut:0));
   e.sortAmount=(e.category==='paid'?paid:Math.max(0,cut-paid))*Number(state.usdPer1000||state.usdcPer1000||10)/1000;
   if(e.category==='paid')e.amount=r.submission?.method==='usdc'?(paid*Number(r.paidRateUsdPer1000||state.usdPer1000||state.usdcPer1000||10)/1000).toFixed(2)+' USDC':paid.toLocaleString()+'g';
  }
 }
 return out.sort((a,b)=>a.date-b.date||a.name.localeCompare(b.name));
};
gsPayoutQueue=function(raiders,calc){
 const t=document.createElement('template');t.innerHTML=gsOldQueue(raiders.map(r=>({...r,submission:r.submission?{...r.submission,method:r.submission.method==='usd'?'usdc':r.submission.method}:r.submission})),calc);
 for(const row of t.content.querySelectorAll('tbody tr')){
  const checkbox=row.querySelector('input[type=checkbox]'),action=checkbox?.getAttribute('onchange')||'',match=action.match(/setPayoutPaid\('([^']+)'/);
  if(!match)continue;const r=raiders.find(r=>r.key===match[1]);if(!r)continue;
  const s=r.submission||{},method=r.gsPayoutMethod,amount=row.querySelector('.payout-value strong');if(amount)amount.textContent=payoutDisplayAmount(r,r.paid?r.gsCut:payoutStillDue(r));
  const methodLabel=row.querySelector('.payout-value .settlement-muted');if(methodLabel)methodLabel.textContent=method?payoutLabels[method]:'Method not chosen';
  if(checkbox){checkbox.disabled=!!r.paid||!method;checkbox.title=r.paid?'Payment recorded':!method?'Raider must choose a payout method':'Confirm payment';}
  const select=row.querySelector('select');
  if(select){select.querySelector('option[value=reopenCut]')?.remove();if(!r.paid&&!select.querySelector('option[value=reopen]'))select.insertAdjacentHTML('beforeend','<option value="reopen">Reopen 24h</option>');}
  if(method==='gs'){const details=row.querySelector('.payout-detail-body');if(details)details.textContent='Credit to the linked GC account';}
 }
 return t.innerHTML;
};
const claimActionOriginal=window.runPayoutAction;
function restoredClaimAction(key,action){
 if(!gsContext())return claimActionOriginal(key,action);
 if(!isRL)return;
 if(action==='modify')return gsAdjust(key);
 if(action==='review')return openPayoutReview(key);
 if(action==='dispute')return openCutRequestReview(key);
 if(action==='reopen')return gsAction('claimAdmin',{runId:settlementRunKey(),raiderKey:key,action:'reopen'},'Reopen this claim for 24 hours?');
 if(action==='correction')return requestPayoutCorrection(key);
}
const claimCorrectionOriginal=requestPayoutCorrection;
requestPayoutCorrection=function(key){
 if(!gsContext())return claimCorrectionOriginal(key);
 if(!isRL)return;
 wowConfirm({title:'Request Correction',msg:'Explain what the raider should update.',confirmLabel:'Send',input:{type:'text',placeholder:'Correction needed',maxlength:240,errorMsg:'Enter a correction note'},onConfirm:note=>gsAction('claimAdmin',{runId:settlementRunKey(),raiderKey:key,action:'correction',note:String(note).trim()})});
};
const originalClaimBreakdown=raiderCutBreakdown;
raiderCutBreakdown=function(r,calc){
 const rows=originalClaimBreakdown(r,calc);
 if(!gsContext())return rows;
 const known=rows.filter(row=>!row.included).reduce((sum,row)=>sum+Number(row.amount||0),0),difference=Number(effectiveRaiderCut(r,calc))-known;
 if(Math.abs(difference)>.000001)rows.push({label:Math.abs(difference)<.011?'Rounding':'Other cut adjustments',amount:difference});
 return rows;
};
const claimHero=gsMyPayout;
gsMyPayout=function(){
 const r=payoutCurrentRaider(),method=r?.gsPayoutMethod;
 const heroTemplate=document.createElement('template');heroTemplate.innerHTML=claimHero();
 if(r&&settlement.payoutStarted&&!r.paid&&method)heroTemplate.content.querySelectorAll('[onclick="openCutRequest()"]').forEach(el=>el.remove());
 const hero=heroTemplate.innerHTML;
 if(!r||!settlement.payoutStarted||r.paid)return hero;
 if(!method)return hero+'<section class="settlement-section"><p>Select a payout method above to open your claim form.</p></section>';
 const prior=payoutDraftMethod;payoutDraftMethod=method==='usd'?'usdc':method;
 let html;try{html=gsOldMy();}finally{payoutDraftMethod=prior;}
 const t=document.createElement('template');t.innerHTML=html;
 t.content.querySelector('.payout-methods')?.remove();
 const heading=t.content.querySelector('.settlement-section-title');if(heading)heading.textContent='Submit payout claim';
 const intro=t.content.querySelector('.settlement-section-note');if(intro)intro.textContent='Complete the details below and submit your claim.';
 const amount=t.content.querySelector('.payout-amount strong'),due=payoutStillDue(r);
 if(amount)amount.textContent=method==='gold'?(due*1000/Number(settlement.payoutUsdPer1000||runUsdRate())).toLocaleString(undefined,{maximumFractionDigits:2})+'g':method==='usd'?usdText(due):gsAmount(due);
 if(method==='gs'){
  t.content.querySelectorAll('.payout-section-block').forEach(el=>el.remove());
  const label=t.content.querySelector('.payout-amount .settlement-stat-lbl');if(label)label.textContent='GC payout';
  const note=t.content.querySelector('.payout-amount .settlement-stat-sub');if(note)note.textContent='Submit to request credit to your linked GC account.';
 }
 const rules=t.content.querySelector('.payout-rules');
 if(rules){
  const list=rules.querySelector('ol');
  if(list&&method==='gs')list.innerHTML='<li>Submit your claim within the displayed deadline.</li><li>The leader credits your linked GC account after confirming the claim.</li>';
  else if(list&&method==='usd'){
   const last=list.lastElementChild;if(last)last.textContent='Your USD/USDC amount is shown above. Completed payments retain their recorded amount.';
  }
 }
 if(r.submission?.status==='draft'){
  const badge=t.content.querySelector('.settlement-section-hdr .settlement-status');if(badge){badge.textContent='Details changed · resubmit claim';badge.className='settlement-status warn';}
  const countdown=t.content.querySelector('#payout-claim-countdown');if(countdown)countdown.textContent='Resubmit payout details';
 }

 const note=t.content.querySelector('.payout-amount .settlement-stat-sub');if(note&&method==='usd')note.textContent='USDC payout over Ethereum.';
 if(claimSubmitting||payoutChoicePending)t.content.querySelectorAll('[onclick="submitPayoutListing()"]').forEach(b=>{b.disabled=true;b.textContent=claimSubmitting?'Submitting claim…':'Saving payout method…';});
 return hero+t.innerHTML;
};
let claimSubmitting=false;
const legacySubmitClaim=submitPayoutListing;
submitPayoutListing=async function(){
 if(!gsContext())return legacySubmitClaim();
 if(claimSubmitting||payoutChoicePending)return;
 if(payoutImageBusy){payoutAttachmentNotice('Wait for the screenshot to finish preparing.');return;}
 const r=payoutCurrentRaider(),key=settlementRunKey(),method=r?.gsPayoutMethod;
 if(!r||!method||r.paid){toast('Choose an available payout method first');return;}
 rememberPayoutFields();
 const data={runId:key,raiderKey:r.key,method};
 if(method==='gold'){
  const image=payoutDraftImage?.removed?null:(payoutDraftImage||r.submission);
  Object.assign(data,{seller:payoutDraftFields.seller,item:payoutDraftFields.item,imageData:image?.data||image?.imageData||'',imageName:image?.name||image?.imageName||'auction-screenshot.jpg'});
  if(!data.seller?.trim()||!data.item?.trim()||!data.imageData){toast('Enter the seller, listed item, and screenshot');return;}
 }else if(method==='usd'){data.walletAddress=payoutDraftFields.wallet?.trim();if(!validEthAddress(data.walletAddress||'')){toast('Enter an Ethereum wallet address');return;}}
 const owner=accountDiscordId();claimSubmitting=true;const button=document.querySelector('[onclick="submitPayoutListing()"]');if(button){button.disabled=true;button.textContent='Submitting claim…';}
 try{
  const upload=method==='gold'&&payoutDraftImage?claimImageUploads.get(payoutDraftImage):null;
  if(upload?.path&&upload.runId===key&&upload.owner===owner){data.imageRef=upload.path;delete data.imageData;}
  // Reusing an already submitted screenshot keeps the update request small.
  if(method==='gold'&&!data.imageRef&&payoutSafeImage(data.imageData)?.startsWith('https://')){
   const url=new URL(data.imageData);data.imageRef=decodeURIComponent(url.pathname.split('/o/')[1]);delete data.imageData;
  }
  await gsCall('submitClaim',data);
  if(key===settlementRunKey()&&owner===accountDiscordId()){payoutDraftImage=null;payoutDraftFields={seller:'',item:'',wallet:'',dirty:false};payoutDraftMethod='';}
  toast('Claim submitted');
 }catch(e){
  const message=/Unknown GS operation/.test(e.message)?'The claim backend update must be deployed. Your details and screenshot are retained.':(e.message||'Could not submit the claim')+'. Your details and screenshot are retained.';
  payoutAttachmentNotice(message,true);toast(message);
 }finally{claimSubmitting=false;if(button?.isConnected){button.disabled=false;button.textContent='Submit Claim';}}
};
Object.assign(window,{submitPayoutListing,runPayoutAction:restoredClaimAction,requestPayoutCorrection,gsMyPayout});
const restoredClaimStyle=document.createElement('style');restoredClaimStyle.textContent='.payout-claim+.payout-claim{margin-top:24px}.payout-form-stack{gap:24px}.payout-attach{min-height:140px}.payout-action-select{min-width:160px}';document.head.append(restoredClaimStyle);

const claimHistoryOriginal=openPayoutHistory;
openPayoutHistory=function(key){
 if(!gsContext())return claimHistoryOriginal(key);
 if(!isRL)return;const r=settlement.raiders?.[key];if(!r)return;
 const events=[...Object.values(r.payoutEvents||{}),...Object.values(settlement.gsAdjustments||{}).filter(e=>e.raiderKey===key).map(e=>({...e,type:'adjustment'}))].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
 closePayoutHistory();const el=document.createElement('div');el.id='payout-history-overlay';el.className='payout-review-overlay';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
 el.innerHTML='<div class="payout-review-card"><div class="settlement-section-hdr"><h2>'+settlementEsc(r.name)+' · Payout history</h2><button class="btn btn-outline" onclick="closePayoutHistory()">Close</button></div><p>Remaining: '+payoutDisplayAmount(r,payoutStillDue(r))+'</p>'+events.map(e=>'<div class="payout-history-entry"><div><strong>'+settlementEsc(e.type==='paid'?'Payment recorded':'Cut adjustment')+'</strong> · '+(e.method==='gold'?Number(e.goldAmount||0).toLocaleString()+'g':e.method==='usd'?usdText(e.amount):e.method==='gs'?gsAmount(e.amount):payoutDisplayAmount(null,e.amount))+'<p>'+settlementEsc(e.reason||'')+'</p><small>'+settlementEsc(accountDate(e.createdAt))+'</small></div></div>').join('')+(events.length?'':'<p>No payout events recorded.</p>')+'</div>';
 el.onclick=e=>{if(e.target===el)closePayoutHistory();};el.onkeydown=e=>{if(e.key==='Escape')closePayoutHistory();};document.body.append(el);el.querySelector('button').focus();
};window.openPayoutHistory=openPayoutHistory;



// Start the screenshot upload while the member completes the claim form.
const claimImageUploads=new WeakMap(),claimFileOriginal=handlePayoutFile;
function prepareClaimScreenshot(image){
 if(!image?.data||!gsSnapshot?.claimImagesVersion)return null;
 if(claimImageUploads.has(image))return claimImageUploads.get(image);
 const runId=settlementRunKey(),owner=accountDiscordId(),raiderKey=payoutCurrentRaider()?.key;
 const upload={runId,owner,path:null};
 upload.task=gsCall('prepareClaimImage',{runId,raiderKey,imageData:image.data}).then(result=>{
  upload.path=result.path;
  if(payoutDraftImage===image&&runId===settlementRunKey()&&owner===accountDiscordId())payoutAttachmentNotice('Screenshot uploaded. Ready to submit.');
 }).catch(()=>{
  if(payoutDraftImage===image)payoutAttachmentNotice('Screenshot attached. It will upload when you submit.');
 });
 claimImageUploads.set(image,upload);return upload;
}
handlePayoutFile=async function(file){await claimFileOriginal(file);if(gsContext()&&payoutDraftImage?.data)prepareClaimScreenshot(payoutDraftImage);};
window.handlePayoutFile=handlePayoutFile;
const claimInlineImage=payoutSafeImage;
payoutSafeImage=function(value){
 const text=String(value||'');
 return /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/godspeed-gdkp\.firebasestorage\.app\/o\/claim-images%2F[A-Za-z0-9_-]+%2F[0-9]+%2F[a-f0-9]{64}\?alt=media&token=[A-Za-z0-9%-]+$/.test(text)?text:claimInlineImage(value);
};

// Hide a checked payout while saving without changing authoritative balances.
const fastPayoutPending=new Set(),fastPayoutSaved=new Map();
const fastPayoutKey=(run,key)=>JSON.stringify([accountDiscordId(),run,key]);
const fastPayoutCategoryOriginal=payoutQueueCategory;
payoutQueueCategory=function(r,calc){
 if(gsContext()&&r.paid&&Number(r.gsCredited||0)>=Number(r.gsCut||0))return 'paid';
 return fastPayoutCategoryOriginal(r,calc);
};
function fastPayoutHidden(r){
 const key=fastPayoutKey(settlementRunKey(),r.key),saved=fastPayoutSaved.get(key);
 const complete=!!r.paid&&Number(r.gsCredited||0)>=Number(r.gsCut||0);
 if(saved!==undefined&&(complete||Number(r.gsCut)!==saved))fastPayoutSaved.delete(key);
 return fastPayoutPending.has(key)||fastPayoutSaved.has(key)||complete;
}
const fastPayoutQueueOriginal=gsPayoutQueue;
gsPayoutQueue=function(raiders,calc){
 const t=document.createElement('template');t.innerHTML=fastPayoutQueueOriginal(raiders,calc);
 const hidden=new Set(raiders.filter(fastPayoutHidden).map(r=>r.key));
 for(const checkbox of t.content.querySelectorAll('input[type=checkbox][onchange]')){
  const match=checkbox.getAttribute('onchange').match(/setPayoutPaid\('([^']+)'/);
  if(!match)continue;
  checkbox.title='Record payment already delivered';
  const key=fastPayoutKey(settlementRunKey(),match[1]);
  if(fastPayoutPending.has(key)||fastPayoutSaved.has(key)||(payoutQueueFilter!=='paid'&&hidden.has(match[1])))checkbox.closest('tr')?.remove();
 }
 const all=t.content.querySelector('[onclick="setPayoutQueueFilter(\'all\')"]');
 if(all)all.textContent='Unpaid ('+raiders.filter(r=>!hidden.has(r.key)).length+')';
 for(const category of ['ready','unclaimed','correction','dispute']){
  const button=t.content.querySelector('[onclick="setPayoutQueueFilter(\''+category+'\')"]');
  if(button)button.textContent=button.textContent.replace(/\(\d+\)/,'('+raiders.filter(r=>!hidden.has(r.key)&&payoutQueueCategory(r,calc)===category).length+')');
 }
 const note=t.content.querySelector('.settlement-section-note');
 if(note)note.textContent=raiders.filter(r=>!hidden.has(r.key)&&payoutQueueCategory(r,calc)==='ready').length+' ready to pay · '+raiders.filter(r=>!hidden.has(r.key)).length+' unpaid. Paid can be checked without reviewing a claim.';
 const body=t.content.querySelector('tbody');
 if(body&&!body.children.length)body.innerHTML='<tr><td colspan="5" class="settlement-empty">No payouts in this view.</td></tr>';
 const shown=t.content.querySelector('.settlement-muted[aria-live="polite"]');
 if(shown)shown.textContent=t.content.querySelectorAll('tbody input[type=checkbox]').length+' raiders shown';
 return t.innerHTML;
};
const fastPaidOriginal=setPayoutPaid;
setPayoutPaid=function(key,paid){
 if(gsContext()&&paid){
  const id=fastPayoutKey(settlementRunKey(),key);
  if(fastPayoutPending.has(id)||fastPayoutSaved.has(id))return;
  return gsCredit(key,true);
 }
 return fastPaidOriginal(key,paid);
};window.setPayoutPaid=setPayoutPaid;
const fastPayoutCallOriginal=gsCall;
gsCall=function(op,data={},id){
 if(op!=='creditCut')return fastPayoutCallOriginal(op,data,id);
 const key=fastPayoutKey(data.runId,data.raiderKey),owner=accountDiscordId();
 const cut=Number(settlement.raiders?.[data.raiderKey]?.gsCut);
 fastPayoutPending.add(key);
 const refresh=()=>{if(owner===accountDiscordId()&&data.runId===settlementRunKey()&&tab==='settlement'){const y=window.scrollY;renderMain();window.scrollTo(0,y);}};
 refresh();
 return Promise.resolve().then(()=>fastPayoutCallOriginal(op,data,id)).then(result=>{
  fastPayoutSaved.set(key,cut);return result;
 }).catch(error=>{
  fastPayoutSaved.delete(key);
  hybridError('Payment save was not confirmed. The row has been restored. '+(error.message||'Check its status before retrying.'));
  throw error;
 }).finally(()=>{fastPayoutPending.delete(key);refresh();});
};
const fastPayoutStyle=document.createElement('style');
fastPayoutStyle.textContent='.payout-actions{grid-template-columns:max-content minmax(130px,170px);gap:.75rem}.payout-actions label{white-space:nowrap;word-break:normal;overflow-wrap:normal;flex-shrink:0}.payout-actions input[type=checkbox]{flex:0 0 auto}';
document.head.append(fastPayoutStyle);
