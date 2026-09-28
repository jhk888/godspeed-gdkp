
// Account guidance uses the existing purchase and payout actions.
function raiderNextStep(r,started,category,expired,purchasesDue){
 if(purchasesDue>0)return {text:'You have purchases awaiting payment.',action:'purchases',label:'Review purchases'};
 if(!r)return {text:'Your attendance has not been linked to a cut for this run.',action:'payout',label:'View payout'};
 if(category==='dispute')return {text:'Your dispute is awaiting the raid leader’s review.',action:'payout',label:'View payout'};
 if(category==='paid')return {text:'Your payout is complete. Payment details are available in My Payout.',action:'payout',label:'View completed payout'};
 if(!started)return {text:'Payouts have not started for this run.',action:'payout',label:'View payout'};
 if(category==='correction')return {text:'The raid leader requested a correction. Review the note and resubmit your claim.',action:'payout',label:'Correct claim'};
 if(expired)return {text:'Your claim window has expired. Contact the raid leader to reopen it.',action:'payout',label:'View claim'};
 if(['gold','usdc','gs','ready'].includes(category))return {text:'Your claim is submitted and awaiting payment.',action:'payout',label:'View submitted claim'};
 return {text:'Choose your payout method and complete the claim details.',action:'payout',label:'Complete claim'};
}
function raiderGuidanceHTML(){
 if(!user)return '';
 const r=payoutCurrentRaider(),coin=gsContext(),category=r?(coin?gcClaimCategory(r):payoutQueueCategory(r,calculateSettlementCuts())):'';
 const next=raiderNextStep(r,!!settlement.payoutStarted,category,r?(!r.submission?.submittedAt&&payoutClaimExpired(r)):false,psPurchases().due);
 return '<section class="user-settings-sec" data-raider-guidance><h3 class="user-settings-sec-label">Next step · '+settlementEsc(raidSettings.raidTitle||'Current run')+'</h3><p>'+settlementEsc(next.text)+'</p><button type="button" class="btn btn-outline" onclick="raiderOpenNextStep(\''+next.action+'\')">'+settlementEsc(next.label)+'</button></section>';
}
function raiderRefreshGuidance(){
 const root=document.querySelector('#user-settings-overlay .user-settings-wrap');if(!root)return;
 const existing=root.querySelector('[data-raider-guidance]'),html=raiderGuidanceHTML();
 if(existing){if(existing.outerHTML!==html){const template=document.createElement('template');template.innerHTML=html;if(template.content.firstElementChild)existing.replaceWith(template.content.firstElementChild);else existing.remove();}}
 else if(html)root.insertAdjacentHTML('afterbegin',html);
}
function raiderOpenNextStep(action){closeUserSettings();if(action==='purchases')psOpen();else setTab('payout');}
const raiderAccountOpenOriginal=openUserSettings;
openUserSettings=function(...args){const result=raiderAccountOpenOriginal(...args);raiderRefreshGuidance();return result;};
const raiderGuidanceRenderOriginal=renderMain;
renderMain=function(...args){const result=raiderGuidanceRenderOriginal(...args);raiderRefreshGuidance();return result;};
Object.assign(window,{openUserSettings,raiderOpenNextStep});
