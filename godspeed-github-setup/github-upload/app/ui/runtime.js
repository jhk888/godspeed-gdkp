// Browser-owned interaction state. Server snapshots remain authoritative.
const hybridViews=new WeakMap();
function hybridNodeKey(node){
 if(node.nodeType!==1)return '';
 return node.id||node.getAttribute('data-hybrid-key')||'';
}
function hybridSameNode(a,b){return a.nodeType===b.nodeType&&(a.nodeType!==1||(a.tagName===b.tagName&&hybridNodeKey(a)===hybridNodeKey(b)));}
function hybridPatchNode(old,next){
 if(old.nodeType!==1){if(old.nodeValue!==next.nodeValue)old.nodeValue=next.nodeValue;return;}
 const editing=old===document.activeElement&&old.matches('input:not([type=checkbox]):not([type=radio]),textarea,select');
 const value=editing?old.value:null,start=editing?old.selectionStart:null,end=editing?old.selectionEnd:null;
 const open=old.tagName==='DETAILS'?old.open:null;
 for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name)&&!(attr.name==='open'&&open!==null))old.removeAttribute(attr.name);
 for(const attr of [...next.attributes])if(attr.name!=='open'&&old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
 if(old.tagName!=='INPUT'&&old.tagName!=='TEXTAREA')hybridPatchChildren(old,next);
 if(old.tagName==='INPUT'){
  if(old.type==='checkbox'||old.type==='radio')old.checked=next.checked;
  else if(old.type!=='file'&&!editing&&old.value!==next.value)old.value=next.value;
 }else if(old.tagName==='TEXTAREA'&&!editing)old.value=next.value;
 else if(old.tagName==='SELECT'&&!editing)old.value=next.value;
 if(open!==null)old.open=open;
 if(editing){old.value=value;if(start!==null)try{old.setSelectionRange(start,end);}catch{}}
}
function hybridPatchChildren(parent,next){
 const keyed=new Map([...parent.childNodes].filter(n=>hybridNodeKey(n)).map(n=>[hybridNodeKey(n),n]));
 let cursor=parent.firstChild;
 for(const incoming of [...next.childNodes]){
  const key=hybridNodeKey(incoming);
  let current=key?keyed.get(key):cursor;
  if(!current||!hybridSameNode(current,incoming)){current=incoming.cloneNode(true);parent.insertBefore(current,cursor);}
  else {if(current!==cursor)parent.insertBefore(current,cursor);hybridPatchNode(current,incoming);}
  cursor=current.nextSibling;
 }
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
}
function hybridRender(root,html,context){
 if(!root)return;
 if(hybridViews.get(root)!==context){root.innerHTML=html;hybridViews.set(root,context);return;}
 const template=document.createElement('template');template.innerHTML=html;
 hybridPatchChildren(root,template.content);
}
function hybridError(message){
 let box=document.getElementById('hybrid-save-error');
 if(!box){box=document.createElement('aside');box.id='hybrid-save-error';box.setAttribute('role','alert');box.style.cssText='position:fixed;bottom:18px;right:18px;z-index:450;max-width:min(440px,90vw);padding:16px;background:#241811;color:#fff1d2;border:1px solid #cc8054;border-radius:4px;box-shadow:0 6px 24px #0008';const text=document.createElement('p');text.style.cssText='white-space:pre-wrap;margin:0 0 12px';const close=document.createElement('button');close.type='button';close.className='btn btn-outline btn-sm';close.textContent='Dismiss';close.onclick=()=>box.remove();box.append(text,close);document.body.append(box);}
 box.querySelector('p').textContent=String(message||'Could not save. Please retry.');
}
