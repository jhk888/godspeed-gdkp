const fs=require('node:fs'),path=require('node:path');const {calculateCuts}=require('./functions/core');
const source=path.resolve(__dirname,'source/base.html');let html=fs.readFileSync(source,'utf8');
function replace(a,b){if(!html.includes(a))throw Error('Missing integration anchor: '+a.slice(0,90));html=html.replace(a,()=>b);}
replace("import { initializeApp }", "import {getAuth,signInWithCustomToken,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';\nimport {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';\nimport { initializeApp }");
replace('const _urlParams = new URLSearchParams(window.location.search);','const GS_CALCULATE='+calculateCuts.toString()+';\n'+fs.readFileSync(path.join(__dirname,'client.js'),'utf8')+'\nconst _urlParams = new URLSearchParams(window.location.search);');
replace('</style>','.gs-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.8rem;margin:1rem 0}.gs-fields label{display:flex;flex-direction:column;gap:.35rem}.gs-fields input,.gs-fields select{min-width:0;width:100%;box-sizing:border-box;background:var(--bg-input);color:var(--text-bright);padding:.5rem;border:1px solid var(--border-gold)}.gs-address{overflow-wrap:anywhere}.gs-payout-row{padding:.8rem 0;border-bottom:1px solid var(--border-gold)}\n</style>');
replace('Build 45','Build 54 · Auction Defaults');
replace('Start bid (g)',"Start bid (${gsContext()?'GS':'g'})");
replace('Bid buttons (g increments)',"Bid buttons (${gsContext()?'GS':'g'} increments)");
replace('>g each</span>',">${gsContext()?'GS':'g'} each</span>");
replace('value="${a?a.currentBid:1000}"', 'value="${a?a.currentBid:gsContext()?10:1000}"');
replace('const bidBtns=a?a.bidButtons||raidSettings.defaultBidButtons||[250,500,1000]:raidSettings.defaultBidButtons||[250,500,1000];','const bidBtns=a?a.bidButtons||raidSettings.defaultBidButtons||[250,500,1000]:gsContext()?[1,5,10]:raidSettings.defaultBidButtons||[250,500,1000];');
replace("gold:'Purchase ready',usdc:'USDC ready'","gold:'Purchase ready',usdc:'USDC ready',gs:'GS ready'");
html=html.replaceAll("['gold','usdc'].includes(e.category)","['gold','usdc','gs'].includes(e.category)");
replace('<option value="usdc">USDC ready</option>','<option value="usdc">USDC ready</option><option value="gs">GS ready</option>');
replace("const _savedUser = localStorage.getItem('gdkp_user');","const _savedUser = gsAuth.currentUser ? localStorage.getItem('gdkp_user') : null;");
replace("const _savedDiscord = localStorage.getItem('gdkp_discord');","const _savedDiscord = gsAuth.currentUser ? localStorage.getItem('gdkp_discord') : null;");

// New runs start in coin mode; legacy runs with no explicit mode retain gold semantics.
replace('settlement={...JSON.parse(JSON.stringify(DEFAULT_SETTLEMENT)),managementCut:nextCut,','settlement={...JSON.parse(JSON.stringify(DEFAULT_SETTLEMENT)),settlementMode:"coin",gsCutLines:{lead:15,treasury:5,risk:5,handling:0},gsHaircutPct:0,goldEnabled:false,managementCut:nextCut,');
replace('const initialSettlement={...DEFAULT_SETTLEMENT,managementCut:','const initialSettlement={...DEFAULT_SETTLEMENT,settlementMode:"coin",gsCutLines:{lead:15,treasury:5,risk:5,handling:0},managementCut:');
// Keep gold-accounting amounts out of the GS legacy ledger display.
replace("function accountActivityRows(){","function accountActivityRows(){");
fs.mkdirSync(path.join(__dirname,'public'),{recursive:true});fs.writeFileSync(path.join(__dirname,'public/index.html'),html);
console.log('Built full index.html with GS extension');

