(() => {
  'use strict';
  const DATA_KEY = 'malai:data:v1';
  const SETTINGS_KEY = 'malai:settings:v1';
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const storageMeta = {
    freezer: { label: 'מקפיא', icon: '❄️' },
    fridge: { label: 'מקרר', icon: '🥛' },
    pantry: { label: 'ארון / מזווה', icon: '🫙' },
    other: { label: 'אחר', icon: '📦' }
  };
  const categoryEmoji = {'מזון לבישול':'🥩','מזון מוכן':'🍲','ירקות ופירות':'🥬','מוצרי חלב':'🥛','לחם ומאפים':'🥖','מזווה':'🫙','אחר':'📦'};
  const defaultState = () => ({
    version: 1,
    storages: [
      {id:uid(), name:'המקרר במטבח', type:'fridge'},
      {id:uid(), name:'המקפיא הראשי', type:'freezer'},
      {id:uid(), name:'המזווה', type:'pantry'}
    ],
    items: [],
    updatedAt: new Date().toISOString()
  });
  let state = loadJSON(DATA_KEY, null) || defaultState();
  let settings = loadJSON(SETTINGS_KEY, { apiKey:'', model:'gpt-4.1-mini' });
  let recorder = null, audioChunks = [];

  // Capture a one-time token, then remove all sensitive parameters before rendering.
  const incoming = new URL(location.href);
  const incomingToken = incoming.searchParams.get('token') || incoming.searchParams.get('api_key');
  if (incomingToken) {
    settings.apiKey = incomingToken;
    saveJSON(SETTINGS_KEY, settings);
    incoming.searchParams.delete('token');
    incoming.searchParams.delete('api_key');
    history.replaceState({}, document.title, incoming.pathname + (incoming.search ? incoming.search : '') + incoming.hash);
  }

  function loadJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function persist() { state.updatedAt = new Date().toISOString(); saveJSON(DATA_KEY, state); render(); }
  function esc(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function toast(text) { const el=$('#toast'); el.textContent=text; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2600); }
  function storageById(id) { return state.storages.find(s=>s.id===id); }
  function findStorage(value='') { const n=value.trim().toLowerCase(); return state.storages.find(s=>s.id===value || s.name.toLowerCase()===n || s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase())); }
  function findItem(name='', storageName='') {
    const n=name.trim().toLowerCase(), store=findStorage(storageName);
    return state.items.find(i => (i.id===name || i.name.toLowerCase()===n || i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase())) && (!store || i.storageId===store.id));
  }
  function normalizeCategory(v='') {
    const cats=Object.keys(categoryEmoji); const match=cats.find(c=>c===v || c.includes(v) || v.includes(c)); return match || 'אחר';
  }

  function render() {
    const query=$('#searchInput')?.value.trim().toLowerCase() || '';
    const sf=$('#storageFilter')?.value || 'all', cf=$('#categoryFilter')?.value || 'all';
    $('#totalItems').textContent = state.items.length;
    const freezerCount=state.items.filter(i=>storageById(i.storageId)?.type==='freezer').length;
    const readyCount=state.items.filter(i=>i.category==='מזון מוכן').length;
    const storageCount=state.storages.length;
    $('#statsGrid').innerHTML = [
      ['❄️',freezerCount,'פריטים במקפיאים'],['🍲',readyCount,'מנות אוכל מוכן'],['🏠',storageCount,'מקומות אחסון']
    ].map(([icon,n,label])=>`<div class="stat-card"><span class="stat-icon">${icon}</span><div><strong>${n}</strong><span>${label}</span></div></div>`).join('');

    const currentSF=$('#storageFilter').value, currentCF=$('#categoryFilter').value;
    $('#storageFilter').innerHTML='<option value="all">כל המקומות</option>'+state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('#storageFilter').value=state.storages.some(s=>s.id===currentSF)?currentSF:'all';
    const categories=[...new Set([...Object.keys(categoryEmoji),...state.items.map(i=>i.category)])];
    $('#categoryFilter').innerHTML='<option value="all">כל הסוגים</option>'+categories.map(c=>`<option>${esc(c)}</option>`).join('');
    $('#categoryFilter').value=categories.includes(currentCF)?currentCF:'all';
    $('#itemStorage').innerHTML=state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');

    const visible=state.items.filter(i => (!query || `${i.name} ${i.note||''}`.toLowerCase().includes(query)) && (sf==='all'||i.storageId===sf) && (cf==='all'||i.category===cf));
    $('#inventoryList').innerHTML=visible.length ? visible.map(i=>{
      const s=storageById(i.storageId);
      return `<article class="item-row" data-id="${i.id}"><span class="item-emoji">${categoryEmoji[i.category]||'📦'}</span><div class="item-main"><strong>${esc(i.name)}</strong><small>${esc(i.category)} · ${esc(s?.name||'ללא מיקום')}${i.note?` · ${esc(i.note)}`:''}</small></div><div class="quantity"><strong>${Number(i.quantity).toLocaleString('he-IL')}</strong> <span>${esc(i.unit)}</span></div><div class="item-actions"><button data-action="consume" title="השתמשתי">− השתמשתי</button><button data-action="edit" title="עריכה">✎</button><button data-action="delete" title="מחיקה">⌫</button></div></article>`;
    }).join('') : '<div class="empty">אין כאן פריטים עדיין.<br>אפשר להוסיף ידנית או פשוט לומר לעוזר מה נכנס הביתה.</div>';

    $('#storageList').innerHTML=state.storages.map(s=>{
      const count=state.items.filter(i=>i.storageId===s.id).length, meta=storageMeta[s.type]||storageMeta.other;
      return `<article class="storage-card"><span class="stat-icon">${meta.icon}</span><div><strong>${esc(s.name)}</strong><small>${meta.label} · ${count} פריטים</small></div></article>`;
    }).join('');
  }

  function openItem(item=null) {
    if (!state.storages.length) return toast('קודם צריך להוסיף מקום אחסון');
    $('#itemDialogTitle').textContent=item?'עריכת פריט':'פריט חדש';
    $('#itemId').value=item?.id||''; $('#itemName').value=item?.name||''; $('#itemQuantity').value=item?.quantity??1;
    $('#itemUnit').value=item?.unit||'יחידות'; $('#itemCategory').value=item?.category||'מזון לבישול'; $('#itemStorage').value=item?.storageId||state.storages[0].id; $('#itemNote').value=item?.note||'';
    $('#itemDialog').showModal();
  }
  function addMessage(text, role='assistant') { const box=$('#messages'); box.classList.add('has-content'); box.insertAdjacentHTML('beforeend',`<div class="message ${role}">${esc(text)}</div>`); box.scrollTop=box.scrollHeight; }
  function setBusy(on, label='חושב ומעדכן את המלאי…') { $('#sendBtn').disabled=on; $('#micBtn').disabled=on; $('#assistantStatus').textContent=on?label:'אפשר לכתוב או לדבר אליי'; }

  async function openAI(path, options) {
    if (!settings.apiKey) { $('#settingsDialog').showModal(); throw new Error('צריך להוסיף OpenAI API Key בהגדרות'); }
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),45000);
    try {
      const res=await fetch(`https://api.openai.com/v1/${path}`,{...options,headers:{Authorization:`Bearer ${settings.apiKey}`,...options.headers},signal:ctrl.signal});
      const data=await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error?.message || `שגיאת OpenAI (${res.status})`);
      return data;
    } finally { clearTimeout(timer); }
  }

  async function runCommand(text) {
    text=text.trim(); if(!text)return;
    addMessage(text,'user'); $('#commandInput').value=''; setBusy(true);
    const inventory=state.items.map(i=>({id:i.id,name:i.name,quantity:i.quantity,unit:i.unit,category:i.category,storage:storageById(i.storageId)?.name}));
    const storages=state.storages.map(s=>({id:s.id,name:s.name,type:s.type}));
    const schema={name:'inventory_actions',strict:true,schema:{type:'object',additionalProperties:false,properties:{reply:{type:'string'},actions:{type:'array',items:{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['add_storage','add_item','consume_item','move_item','update_item','delete_item','none']},item_name:{type:'string'},quantity:{type:'number'},unit:{type:'string'},category:{type:'string'},storage_name:{type:'string'},destination_name:{type:'string'},storage_type:{type:'string',enum:['freezer','fridge','pantry','other']},note:{type:'string'}},required:['type','item_name','quantity','unit','category','storage_name','destination_name','storage_type','note']}}},required:['reply','actions']}};
    const system=`את עוזרת לניהול מלאי מזון ביתי בעברית. הפכי את בקשת המשתמש לפעולות מדויקות. אפשר להחזיר כמה פעולות. בשאלות מידע בלבד החזירי actions ריק ותשובה המבוססת אך ורק על המלאי. כשמוסיפים פריט למיקום שלא קיים, צרי קודם add_storage. כשאומרים השתמשתי/נגמר, consume_item מפחית כמות; אם לא נאמרה כמות השתמשי בכמות הקיימת כדי להסיר. קטגוריות מועדפות: מזון לבישול, מזון מוכן, ירקות ופירות, מוצרי חלב, לחם ומאפים, מזווה, אחר. אל תמציאי פריטים. מלאי נוכחי: ${JSON.stringify(inventory)}. מקומות: ${JSON.stringify(storages)}.`;
    try {
      const data=await openAI('chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:settings.model||'gpt-4.1-mini',temperature:0.1,messages:[{role:'system',content:system},{role:'user',content:text}],response_format:{type:'json_schema',json_schema:schema}})});
      const result=JSON.parse(data.choices?.[0]?.message?.content||'{}');
      const changed=applyActions(result.actions||[]);
      addMessage(result.reply || (changed?'בוצע. המלאי עודכן.':'לא מצאתי פעולה לבצע.'));
      if(changed){ persist(); toast('המלאי עודכן'); }
    } catch(err) { addMessage(err.name==='AbortError'?'הבקשה ארכה יותר מדי. אפשר לנסות שוב.':err.message); }
    finally { setBusy(false); }
  }

  function applyActions(actions) {
    let changed=false;
    for(const a of actions) {
      if(a.type==='none') continue;
      if(a.type==='add_storage') {
        if(!findStorage(a.storage_name)){ state.storages.push({id:uid(),name:a.storage_name||'מקום חדש',type:a.storage_type||'other'}); changed=true; }
      }
      if(a.type==='add_item') {
        let s=findStorage(a.storage_name);
        if(!s){s={id:uid(),name:a.storage_name||'מקום חדש',type:a.storage_type||'other'};state.storages.push(s);}
        const same=findItem(a.item_name,a.storage_name);
        if(same && same.unit===(a.unit||same.unit)){same.quantity=Number(same.quantity)+Number(a.quantity||1);same.note=a.note||same.note;}
        else state.items.push({id:uid(),name:a.item_name||'פריט',quantity:Number(a.quantity||1),unit:a.unit||'יחידות',category:normalizeCategory(a.category),storageId:s.id,note:a.note||'',createdAt:new Date().toISOString()});
        changed=true;
      }
      if(a.type==='consume_item') {
        const i=findItem(a.item_name,a.storage_name); if(!i)continue;
        const q=Number(a.quantity)>0?Number(a.quantity):Number(i.quantity); i.quantity=Math.max(0,Number(i.quantity)-q);
        if(i.quantity===0)state.items=state.items.filter(x=>x.id!==i.id); changed=true;
      }
      if(a.type==='move_item') {
        const i=findItem(a.item_name,a.storage_name), s=findStorage(a.destination_name); if(i&&s){i.storageId=s.id;changed=true;}
      }
      if(a.type==='update_item') {
        const i=findItem(a.item_name,a.storage_name); if(!i)continue;
        if(a.quantity>0)i.quantity=a.quantity; if(a.unit)i.unit=a.unit; if(a.category)i.category=normalizeCategory(a.category); if(a.note)i.note=a.note;
        const s=findStorage(a.destination_name); if(s)i.storageId=s.id; changed=true;
      }
      if(a.type==='delete_item') { const i=findItem(a.item_name,a.storage_name); if(i){state.items=state.items.filter(x=>x.id!==i.id);changed=true;} }
    }
    return changed;
  }

  async function toggleRecording() {
    if(recorder?.state==='recording'){recorder.stop();return;}
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true}); audioChunks=[];
      recorder=new MediaRecorder(stream); recorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);
      recorder.onstop=async()=>{ $('#micBtn').classList.remove('recording'); stream.getTracks().forEach(t=>t.stop()); setBusy(true,'מתמלל את ההקלטה…');
        try { const blob=new Blob(audioChunks,{type:recorder.mimeType||'audio/webm'}), form=new FormData(); form.append('file',blob,'recording.webm'); form.append('model','whisper-1'); form.append('language','he');
          const data=await openAI('audio/transcriptions',{method:'POST',body:form}); await runCommand(data.text||'');
        } catch(err){addMessage(err.message);} finally{setBusy(false);} };
      recorder.start(); $('#micBtn').classList.add('recording'); $('#assistantStatus').textContent='מקליט… לחיצה נוספת לסיום';
    } catch { toast('לא התקבלה הרשאה למיקרופון'); }
  }

  $('#addItemBtn').onclick=()=>openItem(); $('#addStorageBtn').onclick=()=>$('#storageDialog').showModal(); $('#settingsBtn').onclick=()=>{ $('#apiKey').value=settings.apiKey||'';$('#modelName').value=settings.model||'gpt-4.1-mini';$('#settingsDialog').showModal(); };
  $$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $('#itemForm').onsubmit=e=>{e.preventDefault();const id=$('#itemId').value, item={id:id||uid(),name:$('#itemName').value.trim(),quantity:Number($('#itemQuantity').value),unit:$('#itemUnit').value,category:$('#itemCategory').value,storageId:$('#itemStorage').value,note:$('#itemNote').value.trim(),createdAt:new Date().toISOString()};const idx=state.items.findIndex(i=>i.id===id);if(idx>=0)state.items[idx]={...state.items[idx],...item};else state.items.unshift(item);$('#itemDialog').close();persist();toast('הפריט נשמר');};
  $('#storageForm').onsubmit=e=>{e.preventDefault();state.storages.push({id:uid(),name:$('#storageName').value.trim(),type:$('#storageType').value});e.target.reset();$('#storageDialog').close();persist();toast('המקום נוסף');};
  $('#settingsForm').onsubmit=e=>{e.preventDefault();settings={apiKey:$('#apiKey').value.trim(),model:$('#modelName').value.trim()||'gpt-4.1-mini'};saveJSON(SETTINGS_KEY,settings);$('#settingsDialog').close();toast('ההגדרות נשמרו במכשיר');};
  $('#clearDataBtn').onclick=()=>{if(confirm('למחוק את כל המלאי וההגדרות מהמכשיר הזה?')){localStorage.removeItem(DATA_KEY);localStorage.removeItem(SETTINGS_KEY);state=defaultState();settings={apiKey:'',model:'gpt-4.1-mini'};$('#settingsDialog').close();render();toast('הנתונים נמחקו');}};
  $('#inventoryList').onclick=e=>{const row=e.target.closest('.item-row');if(!row)return;const item=state.items.find(i=>i.id===row.dataset.id),action=e.target.closest('button')?.dataset.action;if(action==='edit')openItem(item);if(action==='delete'&&confirm(`למחוק את ${item.name}?`)){state.items=state.items.filter(i=>i.id!==item.id);persist();}if(action==='consume'){const value=prompt(`כמה ${item.unit} השתמשת?`,String(item.quantity));if(value!==null){item.quantity=Math.max(0,item.quantity-Number(value||0));if(item.quantity===0)state.items=state.items.filter(i=>i.id!==item.id);persist();}}};
  ['searchInput','storageFilter','categoryFilter'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',render));
  $('#sendBtn').onclick=()=>runCommand($('#commandInput').value); $('#commandInput').onkeydown=e=>{if(e.key==='Enter')runCommand(e.target.value);}; $('#micBtn').onclick=toggleRecording;
  $$('.quick-commands button').forEach(b=>b.onclick=()=>runCommand(b.dataset.command));
  if(incomingToken) setTimeout(()=>toast('מפתח OpenAI נשמר והוסר מהכתובת'),200);
  render();
})();
