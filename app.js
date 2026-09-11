(() => {
  'use strict';
  const DATA_KEY = 'malai:data:v1';
  const SETTINGS_KEY = 'malai:settings:v1';
  const MODELS = Object.freeze({
    agent: 'gpt-5.6-luna',
    transcription: 'gpt-4o-transcribe',
    speech: 'gpt-4o-mini-tts'
  });
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const refreshIcons = () => {
    if(window.lucide)window.lucide.createIcons({attrs:{'aria-hidden':'true'}});
    else document.documentElement.classList.add('icons-missing');
  };
  const storageMeta = {
    freezer: { label: 'מקפיא', icon: 'snowflake' },
    fridge: { label: 'מקרר', icon: 'refrigerator' },
    pantry: { label: 'ארון / מזווה', icon: 'archive' },
    other: { label: 'אחר', icon: 'package' }
  };
  const categoryIcons = {'מזון לבישול':'beef','מזון מוכן':'cooking-pot','ירקות ופירות':'salad','מוצרי חלב':'milk','לחם ומאפים':'croissant','מזווה':'package-open','אחר':'package'};
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
  let settings = loadJSON(SETTINGS_KEY, { apiKey:'' });
  let recorder = null, audioChunks = [], currentAudio = null, audioUrl = '';
  let voicePressActive = false;
  let voiceSession = 0;
  const activeControllers = new Set();
  const voiceStates = {
    ready: ['מוכנה', 'אפשר להתחיל לדבר', 'לחצו והחזיקו בזמן הדיבור'],
    recording: ['מקליטה', 'אני מקשיבה…', 'שחררו כדי לשלוח'],
    transcribing: ['מתמללת', 'הופכת את הקול לטקסט…', 'עוד רגע ממשיכים'],
    thinking: ['חושבת ופועלת', 'בודקת ומעדכנת את המלאי…', 'הסוכנת משתמשת במלאי המקומי'],
    speaking: ['עונה', 'התשובה בדרך אליכם', 'אפשר לעצור בסגירת החלון'],
    success: ['בוצע', 'המלאי מעודכן', 'אפשר להמשיך לדבר'],
    error: ['לא הסתדר', 'אפשר לנסות שוב', 'או לעבור לכתיבה']
  };

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
    const cats=Object.keys(categoryIcons); const match=cats.find(c=>c===v || c.includes(v) || v.includes(c)); return match || 'אחר';
  }

  function render() {
    const query=$('#searchInput')?.value.trim().toLowerCase() || '';
    const sf=$('#storageFilter')?.value || 'all', cf=$('#categoryFilter')?.value || 'all';
    $('#totalItems').textContent = state.items.length;
    const freezerCount=state.items.filter(i=>storageById(i.storageId)?.type==='freezer').length;
    const readyCount=state.items.filter(i=>i.category==='מזון מוכן').length;
    const storageCount=state.storages.length;
    $('#statsGrid').innerHTML = [
      ['snowflake',freezerCount,'פריטים במקפיאים'],['cooking-pot',readyCount,'מנות אוכל מוכן'],['house',storageCount,'מקומות אחסון']
    ].map(([iconName,n,label])=>`<div class="stat-card"><span class="stat-icon">${icon(iconName)}</span><div><strong>${n}</strong><span>${label}</span></div></div>`).join('');

    const currentSF=$('#storageFilter').value, currentCF=$('#categoryFilter').value;
    $('#storageFilter').innerHTML='<option value="all">כל המקומות</option>'+state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('#storageFilter').value=state.storages.some(s=>s.id===currentSF)?currentSF:'all';
    const categories=[...new Set([...Object.keys(categoryIcons),...state.items.map(i=>i.category)])];
    $('#categoryFilter').innerHTML='<option value="all">כל הסוגים</option>'+categories.map(c=>`<option>${esc(c)}</option>`).join('');
    $('#categoryFilter').value=categories.includes(currentCF)?currentCF:'all';
    $('#itemStorage').innerHTML=state.storages.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');

    const visible=state.items.filter(i => (!query || `${i.name} ${i.note||''}`.toLowerCase().includes(query)) && (sf==='all'||i.storageId===sf) && (cf==='all'||i.category===cf));
    $('#inventoryList').innerHTML=visible.length ? visible.map(i=>{
      const s=storageById(i.storageId);
      return `<article class="item-row" data-id="${i.id}"><span class="item-emoji">${icon(categoryIcons[i.category]||'package')}</span><div class="item-main"><strong>${esc(i.name)}</strong><small>${esc(i.category)} · ${esc(s?.name||'ללא מיקום')}${i.note?` · ${esc(i.note)}`:''}</small></div><div class="quantity"><strong>${Number(i.quantity).toLocaleString('he-IL')}</strong> <span>${esc(i.unit)}</span></div><div class="item-actions"><button data-action="consume" title="השתמשתי">${icon('minus')} השתמשתי</button><button data-action="edit" title="עריכה">${icon('pencil')}</button><button data-action="delete" title="מחיקה">${icon('trash-2')}</button></div></article>`;
    }).join('') : '<div class="empty">אין כאן פריטים עדיין.<br>אפשר להוסיף ידנית או פשוט לומר לעוזר מה נכנס הביתה.</div>';

    $('#storageList').innerHTML=state.storages.map(s=>{
      const count=state.items.filter(i=>i.storageId===s.id).length, meta=storageMeta[s.type]||storageMeta.other;
      return `<article class="storage-card"><span class="stat-icon">${icon(meta.icon)}</span><div><strong>${esc(s.name)}</strong><small>${meta.label} · ${count} פריטים</small></div></article>`;
    }).join('');
    refreshIcons();
  }

  function openItem(item=null) {
    if (!state.storages.length) return toast('קודם צריך להוסיף מקום אחסון');
    $('#itemDialogTitle').textContent=item?'עריכת פריט':'פריט חדש';
    $('#itemId').value=item?.id||''; $('#itemName').value=item?.name||''; $('#itemQuantity').value=item?.quantity??1;
    $('#itemUnit').value=item?.unit||'יחידות'; $('#itemCategory').value=item?.category||'מזון לבישול'; $('#itemStorage').value=item?.storageId||state.storages[0].id; $('#itemNote').value=item?.note||'';
    $('#itemDialog').showModal();
  }
  function addMessage(text, role='assistant') { const box=$('#messages'); box.classList.add('has-content'); box.insertAdjacentHTML('beforeend',`<div class="message ${role}">${esc(text)}</div>`); box.scrollTop=box.scrollHeight; }
  function setBusy(on, label='חושבת ופועלת במלאי…') { $('#sendBtn').disabled=on; $('#assistantStatus').textContent=on?label:'מוכנה לעזור עם המלאי'; }
  function setVoiceState(name, detail='') {
    const values=voiceStates[name]||voiceStates.ready, button=$('#voiceTalkBtn');
    $('#voiceStateLabel').textContent=values[0]; $('#voiceStatus').textContent=values[1];
    $('#voiceTranscript').textContent=detail||values[2]; button.classList.remove(...Object.keys(voiceStates)); button.classList.add(name);
    $('.voice-wave').classList.toggle('active',name==='recording'||name==='speaking');
    button.disabled=['transcribing','thinking'].includes(name);
    button.setAttribute('aria-label',name==='recording'?'סיום הקלטה':'התחלת הקלטה');
  }
  function stopCurrentAudio() {
    if(currentAudio){currentAudio.onended=null;currentAudio.onerror=null;currentAudio.pause();currentAudio.src='';currentAudio=null;}
    if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl='';}
    if('speechSynthesis' in window)speechSynthesis.cancel();
  }
  function cleanupVoice() {
    voicePressActive=false; voiceSession++; activeControllers.forEach(ctrl=>ctrl.abort()); activeControllers.clear();
    if(recorder){recorder.ondataavailable=null;recorder.onstop=null;if(recorder.state==='recording')recorder.stop();recorder.stream?.getTracks().forEach(t=>t.stop());recorder=null;}
    audioChunks=[];stopCurrentAudio();setBusy(false);setVoiceState('ready');
  }

  async function openAI(path, options) {
    if (!settings.apiKey) { if(!$('#voiceDialog').open)$('#settingsDialog').showModal(); throw new Error('צריך להוסיף OpenAI API Key בהגדרות'); }
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),45000); activeControllers.add(ctrl);
    try {
      const res=await fetch(`https://api.openai.com/v1/${path}`,{...options,headers:{Authorization:`Bearer ${settings.apiKey}`,...options.headers},signal:ctrl.signal});
      const data=await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error?.message || `שגיאת OpenAI (${res.status})`);
      return data;
    } finally { clearTimeout(timer); activeControllers.delete(ctrl); }
  }

  async function speakAnswer(text) {
    if (!text || !settings.apiKey) return;
    setVoiceState('speaking',text);
    const session=voiceSession, ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),45000); activeControllers.add(ctrl);
    try {
      const res=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${settings.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODELS.speech,voice:'coral',input:text,instructions:'דברי בעברית בקול חם, טבעי, ברור ותמציתי.',response_format:'mp3'}),signal:ctrl.signal});
      if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error?.message||`שגיאת קול (${res.status})`);}
      const blob=await res.blob();
      if(session!==voiceSession)return; stopCurrentAudio(); audioUrl=URL.createObjectURL(blob); currentAudio=new Audio(audioUrl);
      currentAudio.onended=()=>{if(session===voiceSession)setVoiceState('success',text);stopCurrentAudio();};
      await currentAudio.play();
    } catch(err) {
      if(session!==voiceSession)return;
      if('speechSynthesis' in window){const u=new SpeechSynthesisUtterance(text);u.lang='he-IL';u.onend=()=>session===voiceSession&&setVoiceState('success',text);u.onerror=()=>session===voiceSession&&setVoiceState('success',text);speechSynthesis.cancel();speechSynthesis.speak(u);}
      else setVoiceState('success',`${text} · השמעת קול אינה זמינה בדפדפן הזה`);
    } finally { clearTimeout(timer); activeControllers.delete(ctrl); }
  }

  async function runCommand(text, {speak=false}={}) {
    text=text.trim(); if(!text)return; const session=voiceSession;
    addMessage(text,'user'); $('#commandInput').value=''; setBusy(true);
    if(speak)setVoiceState('thinking',text);
    const inventory=state.items.map(i=>({id:i.id,name:i.name,quantity:i.quantity,unit:i.unit,category:i.category,storage:storageById(i.storageId)?.name}));
    const storages=state.storages.map(s=>({id:s.id,name:s.name,type:s.type}));
    const schema={name:'inventory_actions',strict:true,schema:{type:'object',additionalProperties:false,properties:{reply:{type:'string'},actions:{type:'array',items:{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['add_storage','add_item','consume_item','move_item','update_item','delete_item','none']},item_name:{type:'string'},quantity:{type:'number'},unit:{type:'string'},category:{type:'string'},storage_name:{type:'string'},destination_name:{type:'string'},storage_type:{type:'string',enum:['freezer','fridge','pantry','other']},note:{type:'string'}},required:['type','item_name','quantity','unit','category','storage_name','destination_name','storage_type','note']}}},required:['reply','actions']}};
    const system=`את עוזרת לניהול מלאי מזון ביתי בעברית. הפכי את בקשת המשתמש לפעולות מדויקות. אפשר להחזיר כמה פעולות. בשאלות מידע בלבד החזירי actions ריק ותשובה המבוססת אך ורק על המלאי. כשמוסיפים פריט למיקום שלא קיים, צרי קודם add_storage. כשאומרים השתמשתי/נגמר, consume_item מפחית כמות; אם לא נאמרה כמות השתמשי בכמות הקיימת כדי להסיר. קטגוריות מועדפות: מזון לבישול, מזון מוכן, ירקות ופירות, מוצרי חלב, לחם ומאפים, מזווה, אחר. אל תמציאי פריטים. מלאי נוכחי: ${JSON.stringify(inventory)}. מקומות: ${JSON.stringify(storages)}.`;
    try {
      const data=await openAI('chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODELS.agent,messages:[{role:'system',content:system},{role:'user',content:text}],response_format:{type:'json_schema',json_schema:schema}})});
      if(speak&&session!==voiceSession)return;
      const result=JSON.parse(data.choices?.[0]?.message?.content||'{}');
      const changed=applyActions(result.actions||[]);
      const reply=result.reply || (changed?'בוצע. המלאי עודכן.':'לא מצאתי פעולה לבצע.');
      addMessage(reply);
      if(changed){ persist(); toast('המלאי עודכן'); }
      if(speak){setVoiceState('success',reply);await speakAnswer(reply);}
      return reply;
    } catch(err) { if(speak&&session!==voiceSession)return;const message=err.name==='AbortError'?'הבקשה הופסקה. אפשר לנסות שוב.':err.message;addMessage(message);if(speak)setVoiceState('error',message); }
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

  async function toggleRecording(voiceMode=false) {
    if(recorder?.state==='recording')return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
      const message='הקלטה אינה נתמכת בדפדפן הזה. אפשר להשתמש בשורת הטקסט.'; toast(message); if(voiceMode)setVoiceState('error',message); return;
    }
    if(!settings.apiKey){const message='לתמלול קולי צריך מפתח OpenAI מקומי. אפשר לעבור לכתיבה בלי מפתח.';setVoiceState('error',message);toast(message);return;}
    try {
      stopCurrentAudio(); const session=voiceSession, stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(session!==voiceSession||(voiceMode&&!voicePressActive)){stream.getTracks().forEach(t=>t.stop());if(voiceMode)setVoiceState('ready');return;} audioChunks=[];
      recorder=new MediaRecorder(stream); const recordingType=recorder.mimeType||'audio/webm'; recorder.ondataavailable=e=>e.data.size&&audioChunks.push(e.data);
      recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recorder=null;if(session!==voiceSession)return;setBusy(true,'מתמללת את ההקלטה…');if(voiceMode)setVoiceState('transcribing');
        try { const blob=new Blob(audioChunks,{type:recordingType}), form=new FormData();
          const extension=recordingType.includes('mp4')?'m4a':recordingType.includes('mpeg')?'mp3':recordingType.includes('ogg')?'ogg':'webm';
          form.append('file',blob,`recording.${extension}`); form.append('model',MODELS.transcription); form.append('language','he');
          const vocabulary=[...state.storages.map(s=>s.name),...state.items.slice(0,40).map(i=>i.name)].filter(Boolean).join(', ');
          form.append('prompt',`מלאי מזון ביתי בעברית. פריזר פירושו מקפיא. פקודות לדוגמה: בפריזר יש שתי לחמניות המבורגר ושני המבורגרים; הוספתי שתי עגבניות למקרר; השתמשתי בקילו עוף; מה יש במקפיא? שמות מוכרים: ${vocabulary}`);
          const data=await openAI('audio/transcriptions',{method:'POST',body:form});if(session===voiceSession)await runCommand(data.text||'',{speak:voiceMode});
        } catch(err){if(session===voiceSession){addMessage(err.message);if(voiceMode)setVoiceState('error',err.message);}} finally{setBusy(false);} };
      recorder.start(); $('#assistantStatus').textContent='מקליטה… שחררו כדי לשלוח';if(voiceMode)setVoiceState('recording');
    } catch { const message='לא התקבלה הרשאה למיקרופון. אפשר להמשיך בכתיבה.';toast(message);if(voiceMode)setVoiceState('error',message); }
  }

  $('#addItemBtn').onclick=()=>openItem(); $('#addStorageBtn').onclick=()=>$('#storageDialog').showModal(); $('#settingsBtn').onclick=()=>{ $('#apiKey').value=settings.apiKey||'';$('#settingsDialog').showModal(); };
  $$('[data-close]').forEach(b=>b.onclick=()=>{const dialog=b.closest('dialog');if(dialog?.id==='voiceDialog')cleanupVoice();dialog.close();});
  $('#itemForm').onsubmit=e=>{e.preventDefault();const id=$('#itemId').value, item={id:id||uid(),name:$('#itemName').value.trim(),quantity:Number($('#itemQuantity').value),unit:$('#itemUnit').value,category:$('#itemCategory').value,storageId:$('#itemStorage').value,note:$('#itemNote').value.trim(),createdAt:new Date().toISOString()};const idx=state.items.findIndex(i=>i.id===id);if(idx>=0)state.items[idx]={...state.items[idx],...item};else state.items.unshift(item);$('#itemDialog').close();persist();toast('הפריט נשמר');};
  $('#storageForm').onsubmit=e=>{e.preventDefault();state.storages.push({id:uid(),name:$('#storageName').value.trim(),type:$('#storageType').value});e.target.reset();$('#storageDialog').close();persist();toast('המקום נוסף');};
  $('#settingsForm').onsubmit=e=>{e.preventDefault();settings={apiKey:$('#apiKey').value.trim()};saveJSON(SETTINGS_KEY,settings);$('#settingsDialog').close();toast('ההגדרות נשמרו במכשיר');};
  $('#clearDataBtn').onclick=()=>{if(confirm('למחוק את כל המלאי וההגדרות מהמכשיר הזה?')){localStorage.removeItem(DATA_KEY);localStorage.removeItem(SETTINGS_KEY);state=defaultState();settings={apiKey:''};render();$('#settingsDialog').close();toast('הנתונים נמחקו');}};
  $('#inventoryList').onclick=e=>{const row=e.target.closest('.item-row');if(!row)return;const item=state.items.find(i=>i.id===row.dataset.id),action=e.target.closest('button')?.dataset.action;if(action==='edit')openItem(item);if(action==='delete'&&confirm(`למחוק את ${item.name}?`)){state.items=state.items.filter(i=>i.id!==item.id);persist();}if(action==='consume'){const value=prompt(`כמה ${item.unit} השתמשת?`,String(item.quantity));if(value!==null){item.quantity=Math.max(0,item.quantity-Number(value||0));if(item.quantity===0)state.items=state.items.filter(i=>i.id!==item.id);persist();}}};
  ['searchInput','storageFilter','categoryFilter'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',render));
  $('#sendBtn').onclick=()=>runCommand($('#commandInput').value); $('#commandInput').onkeydown=e=>{if(e.key==='Enter')runCommand(e.target.value);};
  $('#voiceModeBtn').onclick=()=>{cleanupVoice();$('#voiceDialog').showModal();setVoiceState('ready');refreshIcons();};
  const voiceTalkBtn=$('#voiceTalkBtn');
  const startVoicePress=e=>{
    if(e.type==='pointerdown'&&e.button!==0)return;
    e.preventDefault();
    if(voicePressActive)return;
    voicePressActive=true;
    if(e.pointerId!==undefined)voiceTalkBtn.setPointerCapture?.(e.pointerId);
    toggleRecording(true);
  };
  const endVoicePress=e=>{
    if(!voicePressActive)return;
    e.preventDefault();
    voicePressActive=false;
    if(recorder?.state==='recording')recorder.stop();
  };
  voiceTalkBtn.addEventListener('pointerdown',startVoicePress);
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>voiceTalkBtn.addEventListener(type,endVoicePress));
  voiceTalkBtn.addEventListener('keydown',e=>{if(!e.repeat&&(e.key===' '||e.key==='Enter'))startVoicePress(e);});
  voiceTalkBtn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')endVoicePress(e);});
  $('#voiceTextBtn').onclick=()=>{cleanupVoice();$('#voiceDialog').close();$('#commandInput').focus();};
  $('#voiceDialog').addEventListener('cancel',e=>{e.preventDefault();cleanupVoice();e.currentTarget.close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('#voiceDialog').open)cleanupVoice();});
  $$('.quick-commands button').forEach(b=>b.onclick=()=>runCommand(b.dataset.command));
  if(incomingToken) setTimeout(()=>toast('מפתח OpenAI נשמר והוסר מהכתובת'),200);
  render(); refreshIcons();
})();
