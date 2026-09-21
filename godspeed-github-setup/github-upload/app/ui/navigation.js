// Each open window gets a same-URL history entry. Back dismisses that window,
// leaving the underlying page and any parent window in place.
const uiHistorySession=crypto.randomUUID(),uiHistoryFrames=[];
let uiHistoryChanging=false,uiHistorySerial=0;
const uiWindowSelector='dialog[open],.wow-dialog-overlay,.modal-overlay:not(.queue-panel),.account-payment-overlay,.payout-review-overlay,.unpaid-overlay,.rollout-overlay,#attendance-overlay,#raider-summary-overlay,#user-settings-overlay,#gp-settings,#side-panel.open';
function uiHistoryState(){return {...(history.state||{}),gdkpWindows:{session:uiHistorySession,depth:uiHistoryFrames.length}};}
history.replaceState(uiHistoryState(),'');
function uiWindowVisible(el){return !el.hidden&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';}
function uiWindowClose(el){
 if(el.id==='settlements-dashboard')return closeSettlementsDashboard();
 if(el.id==='attendance-overlay')return closeAttendanceManager();
 if(el.id==='side-panel')return closePanel();
 if(el.id==='gp-settings')return gpCloseSettings();
 if(el.id==='user-settings-overlay')return closeUserSettings();
 if(el.classList.contains('wow-dialog-overlay')){el.querySelector('#wow-cancel,[data-cancel]')?.click();if(el.isConnected)el.remove();return;}
 if(el.id==='modal-overlay')return closeModal();
 if(el.tagName==='DIALOG')el.close();
 el.remove();
}
function uiHistorySync(){
 if(uiHistoryChanging)return;
 if(history.state?.gdkpWindows?.session!==uiHistorySession)history.replaceState(uiHistoryState(),'');
 const windows=[...document.querySelectorAll(uiWindowSelector)].filter(uiWindowVisible);
 // Identity survives an ordinary rerender of the same window.
 for(const el of windows){
  const key=el.id||el.dataset.uiHistoryKey||(el.dataset.uiHistoryKey='window-'+(++uiHistorySerial));
  const frame=uiHistoryFrames.find(f=>f.key===key&&!f.virtual);
  if(frame){frame.el=el;continue;}
  uiHistoryFrames.push({key,el});history.pushState(uiHistoryState(),'');
 }
 let removed=0;
 while(uiHistoryFrames.length){const frame=uiHistoryFrames.at(-1);if(frame.virtual||windows.includes(frame.el))break;uiHistoryFrames.pop();removed++;}
 if(removed){uiHistoryChanging=true;history.go(-removed);}
}
window.addEventListener('popstate',async event=>{
 const state=event.state?.gdkpWindows;
 const depth=state?.session===uiHistorySession?state.depth:0;
 uiHistoryChanging=true;
 try{
  while(uiHistoryFrames.length>depth){const frame=uiHistoryFrames.pop();if(frame.back)await frame.back();else uiWindowClose(frame.el);}
 }finally{uiHistoryChanging=false;uiHistorySync();}
});
new MutationObserver(uiHistorySync).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class','hidden','style']});

// Restore disclosures by stable identity, never by row position. Snapshots and
// clocks can replace markup, but only a user's toggle changes this preference.
const uiDisclosureState=new Map();
function uiDisclosureKey(el){
 const root=el.closest('dialog,[role=dialog],#main,#side-panel')||el.parentElement;
 const row=el.closest('[data-hybrid-key],tr'),section=el.closest('.settlement-section');
 return JSON.stringify([String(accountDiscordId()),root?.id==='settlements-dashboard'?'all-runs':settlementRunKey(),root?.id||'',row?.getAttribute('data-hybrid-key')||row?.querySelector('td')?.textContent||'',section?.querySelector('h2,h3,.settlement-section-title')?.textContent||'',el.id||el.querySelector('summary')?.textContent]);
}
document.addEventListener('click',event=>{
 const summary=event.target.closest('summary');if(!summary||event.defaultPrevented)return;
 const details=summary.parentElement;if(details.tagName!=='DETAILS')return;
 const key=uiDisclosureKey(details);
 // Capture the intended native toggle before asynchronous snapshot updates.
 uiDisclosureState.set(key,!details.open);
},true);
new MutationObserver(records=>{
 for(const record of records)for(const node of record.addedNodes){
  if(node.nodeType!==1)continue;
  const details=[...(node.matches('details')?[node]:[]),...node.querySelectorAll('details')];
  for(const el of details){const saved=uiDisclosureState.get(uiDisclosureKey(el));if(saved!==undefined&&el.open!==saved)el.open=saved;}
 }
}).observe(document.body,{childList:true,subtree:true});

const dashboardOpenFullOriginal=openDashboardSettlement;
openDashboardSettlement=async function(index,action='open'){
 if(action!=='open')return dashboardPayoutAction(index,action);
 const root=document.getElementById('settlements-dashboard');if(!root)return;
 const saved=rwViewState(root),priorArchive=archivedSettlementContext?.key,priorTab=tab,owner=accountDiscordId();
 uiHistorySync();
 const frame=uiHistoryFrames.find(f=>f.el===root);
 if(frame){frame.virtual=true;frame.back=async()=>{
  if(owner!==accountDiscordId()||!isRL)return;
  if(priorArchive){if(archivedSettlementContext?.key!==priorArchive)await openArchivedSettlement(priorArchive);}
  else if(archivedSettlementContext)await closeArchivedSettlement();
  setTab(priorTab);openSettlementsDashboard();rwApplyViewState(document.getElementById('settlements-dashboard'),saved);
 };}
 try{await dashboardOpenFullOriginal(index,action);}catch(error){if(frame){frame.virtual=false;await frame.back();}hybridError(error.message||'Could not open payout');}
};
