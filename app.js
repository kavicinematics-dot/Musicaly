/* Musicly — local-first PWA music player */
(() => {
  const $ = id => document.getElementById(id);
  const dbName = "musicly-local-library", storeName = "tracks";
  let db, tracks = [], playlists = [], currentList = [], currentIndex = -1, currentTrack = null;
  let activeView = "tracks", activeFilter = "all", shuffle = false, repeat = false;
  let crossfadeOn = false, crossfadeSeconds = 10, eqOn = false, spatialOn = false;
  let audioContext, sources = [], gains = [], filters = [], panners = [], fadeTimer = null, fading = false;
  let activeDeck = 0, userQueue = [];
  const audio = [$("audioA"), $("audioB")];

  const openDB = () => new Promise((resolve,reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName,{keyPath:"id"});
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const dbRequest = (mode, action, value) => new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,mode), store = tx.objectStore(storeName);
    const req = action === "all" ? store.getAll() : action === "put" ? store.put(value) : store.delete(value);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const fmt = n => { if(!Number.isFinite(n)) return "0:00"; n=Math.max(0,Math.floor(n)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`; };
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const placeholder = "cover-placeholder.svg";
  const imageFor = t => t?.art || placeholder;

  function parseFilename(file){
    const name=file.name.replace(/\.[^.]+$/,"");
    const parts=name.split(" - ");
    return {title:parts.length>1?parts.slice(1).join(" - "):name,artist:parts.length>1?parts[0]:"Unknown Artist",album:"Unknown Album",composer:"Unknown Composer"};
  }
  function parseID3(buffer, fallback){
    try{
      const v=new DataView(buffer); if(String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2))!=="ID3") return fallback;
      const size=((v.getUint8(6)&127)<<21)|((v.getUint8(7)&127)<<14)|((v.getUint8(8)&127)<<7)|(v.getUint8(9)&127);
      let p=10, end=Math.min(buffer.byteLength,10+size), out={...fallback};
      const map={TIT2:"title",TPE1:"artist",TALB:"album",TCOM:"composer",TPE2:"albumArtist",TYER:"year",TDRC:"year",TCON:"genre"};
      while(p+10<=end){
        const id=String.fromCharCode(v.getUint8(p),v.getUint8(p+1),v.getUint8(p+2),v.getUint8(p+3));
        const len=v.getUint32(p+4); if(!id.trim()||len<=0||p+10+len>end) break;
        if(map[id]){
          const enc=v.getUint8(p+10), bytes=new Uint8Array(buffer,p+11,Math.max(0,len-1));
          let value=""; try{value=new TextDecoder(enc===1||enc===2?"utf-16":"utf-8").decode(bytes).replace(/\0/g,"").trim();}catch{}
          if(value) out[map[id]]=value;
        }
        p+=10+len;
      }
      return out;
    }catch{return fallback;}
  }
  async function readTrack(file){
    const base=parseFilename(file), buf=await file.slice(0,256*1024).arrayBuffer(), tags=parseID3(buf,base);
    return {id:uid(),name:file.name,title:tags.title||base.title,artist:tags.artist||base.artist,album:tags.album||"Unknown Album",
      composer:tags.composer||"Unknown Composer",folder:file.webkitRelativePath?.split("/").slice(0,-1).join("/")||"Device music",
      duration:0,size:file.size,type:file.type||"audio/mpeg",blob:file,added:Date.now(),liked:false,art:null};
  }
  async function addFiles(fileList){
    const files=[...fileList].filter(f=>f.type.startsWith("audio/")||/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name));
    if(!files.length)return;
    for(const file of files){const t=await readTrack(file); await dbRequest("readwrite","put",t); tracks.push(t);}
    render(); alert(`${files.length} track(s) added to your Musicly library.`);
  }
  function trackRow(t,i){
    return `<div class="track-row ${currentTrack?.id===t.id?"playing":""}" data-track="${t.id}">
      <img class="track-art" src="${imageFor(t)}" alt=""><div class="track-main"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div>
      <div class="track-album">${esc(t.album)}</div><span class="track-time">${fmt(t.duration)}</span>
      <button class="track-actions like-btn" data-like="${t.id}" aria-label="Like">${t.liked?"♥":"♡"}</button></div>`;
  }
  function listHTML(list){return `<div class="track-list">${list.map((t,i)=>trackRow(t,i)).join("")}</div>`;}
  function cardHTML(items, labelFn, subFn, imageFn, actionAttr){
    if(!items.length)return emptyHTML();
    return `<div class="card-grid">${items.map(x=>`<div class="library-card" ${actionAttr}="${esc(labelFn(x))}"><img src="${imageFn(x)}" alt=""><b>${esc(labelFn(x))}</b><small>${esc(subFn(x))}</small></div>`).join("")}</div>`;
  }
  function emptyHTML(){return `<div class="empty-state"><strong>Your music library is waiting</strong>Add local audio files or a music folder to get started.<br><button class="primary-btn" onclick="document.getElementById('filePicker').click()">Add music</button></div>`;}
  function render(){
    const q=$("searchInput").value.trim().toLowerCase();
    let list=tracks.filter(t=>[t.title,t.artist,t.album,t.composer,t.folder].join(" ").toLowerCase().includes(q));
    $("quickFilters").style.display=activeView==="tracks"?"flex":"none";
    $("createPlaylistBtn").style.display=activeView==="playlists"?"inline-block":"none";
    const titles={tracks:"Tracks",albums:"Albums",folders:"Folders",playlists:"Playlists",singers:"Singers",composers:"Composers"};
    $("pageTitle").textContent=titles[activeView]||"Music";
    $("pageSubtitle").textContent=`${tracks.length} tracks in your local library`;
    if(activeView==="tracks"){
      if(activeFilter==="recent")list=[...list].sort((a,b)=>b.added-a.added).slice(0,30);
      if(activeFilter==="liked")list=list.filter(t=>t.liked);
      $("viewContent").innerHTML=list.length?listHTML(list):emptyHTML();
    } else if(activeView==="albums"){
      const groups=groupBy(list,t=>t.album);
      $("viewContent").innerHTML=cardHTML([...groups].map(([name,arr])=>({name,arr})),x=>x.name,x=>`${x.arr.length} tracks`,x=>imageFor(x.arr[0]),'data-album');
    } else if(activeView==="folders"){
      const groups=groupBy(list,t=>t.folder||"Device music");
      $("viewContent").innerHTML=cardHTML([...groups].map(([name,arr])=>({name,arr})),x=>x.name,x=>`${x.arr.length} tracks`,x=>imageFor(x.arr[0]),'data-folder');
    } else if(activeView==="singers"||activeView==="composers"){
      const key=activeView==="singers"?"artist":"composer", groups=groupBy(list,t=>t[key]||"Unknown");
      $("viewContent").innerHTML=cardHTML([...groups].map(([name,arr])=>({name,arr})),x=>x.name,x=>`${x.arr.length} tracks`,x=>imageFor(x.arr[0]),activeView==="singers"?'data-singer':'data-composer');
    } else if(activeView==="playlists"){
      $("viewContent").innerHTML=playlists.length?`<div class="card-grid">${playlists.map(p=>`<div class="library-card" data-playlist="${p.id}"><img src="${placeholder}" alt=""><b>${esc(p.name)}</b><small>${p.ids.length} tracks · <button class="text-btn share-playlist" data-share="${p.id}">Share</button></small></div>`).join("")}</div>`:emptyHTML();
    }
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===activeView));
    updateMini();
  }
  function groupBy(arr,fn){const m=new Map();arr.forEach(x=>{const k=fn(x)||"Unknown";if(!m.has(k))m.set(k,[]);m.get(k).push(x)});return m;}
  function playList(list,index=0){
    if(!list.length)return;
    currentList=[...list];currentIndex=index;userQueue=currentList;loadTrack(currentList[currentIndex],true);
  }
  async function ensureAudioGraph(){
    if(audioContext)return;
    audioContext=new (window.AudioContext||window.webkitAudioContext)();
    audio.forEach((el,i)=>{
      const src=audioContext.createMediaElementSource(el), gain=audioContext.createGain();
      const bass=audioContext.createBiquadFilter();bass.type="lowshelf";bass.frequency.value=180;
      const mid=audioContext.createBiquadFilter();mid.type="peaking";mid.frequency.value=1000;mid.Q.value=0.8;
      const treble=audioContext.createBiquadFilter();treble.type="highshelf";treble.frequency.value=5000;
      const pan=audioContext.createStereoPanner();
      src.connect(gain).connect(bass).connect(mid).connect(treble).connect(pan).connect(audioContext.destination);
      sources[i]=src;gains[i]=gain;filters[i]=[bass,mid,treble];panners[i]=pan;gain.gain.value=i===0?1:0;
    });
  }
  async function loadTrack(t,autoplay){
    if(!t)return;clearInterval(fadeTimer);fading=false;currentTrack=t;
    const deck=activeDeck, el=audio[deck];el.src=URL.createObjectURL(t.blob);el.load();
    $("npArtwork").src=imageFor(t);$("npTitle").textContent=t.title;$("npArtist").textContent=`${t.artist} · ${t.album}`;
    updateMini();setMediaSession(t);
    el.onloadedmetadata=()=>{t.duration=el.duration||0;dbRequest("readwrite","put",t);$("totalTime").textContent=fmt(el.duration);};
    el.onended=()=>{if(!fading)nextTrack();};
    if(autoplay){try{await el.play();$("playPauseBtn").textContent="Ⅱ";$("miniPlay").textContent="Ⅱ";}catch(e){console.warn("Playback needs a user gesture",e);}}
    showNowPlaying();
  }
  async function playPause(){
    if(!currentTrack){if(tracks.length)playList(tracks);return;}
    const el=audio[activeDeck];
    if(el.paused){await ensureAudioGraph();if(audioContext.state==="suspended")await audioContext.resume();try{await el.play();}catch{}}
    else el.pause();
    updatePlayButtons();
  }
  function updatePlayButtons(){const paused=audio[activeDeck].paused;$("playPauseBtn").textContent=paused?"▶":"Ⅱ";$("miniPlay").textContent=paused?"▶":"Ⅱ";}
  function nextTrack(){
    if(!currentList.length)return;
    if(shuffle&&currentList.length>1){let n;do{n=Math.floor(Math.random()*currentList.length)}while(n===currentIndex);currentIndex=n;}
    else if(currentIndex<currentList.length-1)currentIndex++;
    else if(repeat)currentIndex=0;else return;
    activeDeck=1-activeDeck;loadTrack(currentList[currentIndex],true);
  }
  function previousTrack(){
    const el=audio[activeDeck];if(el.currentTime>3){el.currentTime=0;return;}
    currentIndex=Math.max(0,currentIndex-1);activeDeck=1-activeDeck;loadTrack(currentList[currentIndex],true);
  }
  function seekBy(seconds){const el=audio[activeDeck];el.currentTime=Math.max(0,Math.min(el.duration||Infinity,el.currentTime+seconds));}
  function showNowPlaying(){$("nowPlaying").classList.remove("hidden");}
  function updateMini(){
    if(currentTrack){$("miniArtwork").src=imageFor(currentTrack);$("miniTitle").textContent=currentTrack.title;$("miniArtist").textContent=currentTrack.artist;}
  }
  function setMediaSession(t){
    if(!("mediaSession" in navigator))return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist,album:t.album,artwork:[{src:imageFor(t),sizes:"512x512",type:"image/png"}]});
      navigator.mediaSession.setActionHandler("play",()=>playPause());
      navigator.mediaSession.setActionHandler("pause",()=>playPause());
      navigator.mediaSession.setActionHandler("previoustrack",previousTrack);
      navigator.mediaSession.setActionHandler("nexttrack",nextTrack);
      navigator.mediaSession.setActionHandler("seekbackward",()=>seekBy(-10));
      navigator.mediaSession.setActionHandler("seekforward",()=>seekBy(10));
    }catch(e){console.warn(e);}
  }
  function startCrossfadeMonitor(){
    clearInterval(fadeTimer);
    fadeTimer=setInterval(async()=>{
      if(!crossfadeOn||!currentTrack||fading||audio[activeDeck].paused||currentIndex>=currentList.length-1)return;
      const el=audio[activeDeck], remaining=el.duration-el.currentTime;
      if(remaining<=crossfadeSeconds && remaining>0.2) await doCrossfade();
    },200);
  }
  async function doCrossfade(){
    if(fading)return;fading=true;await ensureAudioGraph();
    const old=activeDeck,newDeck=1-old, nextIndex=shuffle?Math.floor(Math.random()*currentList.length):currentIndex+1;
    if(!currentList[nextIndex]){fading=false;return;}
    const next=currentList[nextIndex], nextEl=audio[newDeck];
    nextEl.src=URL.createObjectURL(next.blob);nextEl.load();
    await new Promise(resolve=>{nextEl.oncanplay=resolve;nextEl.onerror=resolve;});
    activeDeck=newDeck;currentIndex=nextIndex;nextEl.currentTime=0;
    const now=audioContext.currentTime,d=crossfadeSeconds;
    gains[old].gain.cancelScheduledValues(now);gains[newDeck].gain.cancelScheduledValues(now);
    gains[old].gain.setValueAtTime(1,now);gains[old].gain.linearRampToValueAtTime(0,now+d);
    gains[newDeck].gain.setValueAtTime(0,now);gains[newDeck].gain.linearRampToValueAtTime(1,now+d);
    try{await nextEl.play();}catch{}
    const t=next;currentTrack=t;$("npArtwork").src=imageFor(t);$("npTitle").textContent=t.title;$("npArtist").textContent=`${t.artist} · ${t.album}`;setMediaSession(t);updateMini();
    setTimeout(()=>{audio[old].pause();audio[old].removeAttribute("src");audio[old].load();gains[old].gain.value=0;gains[newDeck].gain.value=1;fading=false;},d*1000);
  }
  function updateEffects(){
    if(!audioContext)return;
    filters.forEach(chain=>{if(!chain)return;chain[0].gain.value=eqOn?Number($("bassRange").value):0;chain[1].gain.value=eqOn?Number($("midRange").value):0;chain[2].gain.value=eqOn?Number($("trebleRange").value):0;});
  }
  function startSpatial(){
    if(!audioContext)return;
    if(!spatialOn){panners.forEach(p=>p&& (p.pan.value=0));return;}
    let phase=0;setInterval(()=>{if(!spatialOn||!audioContext)return;phase+=0.035;const pan=Math.sin(phase)*0.65;panners.forEach(p=>p&&(p.pan.value=pan));},100);
  }
  function updateProgress(){
    const el=audio[activeDeck];if(!el.duration)return;
    $("seekBar").value=Math.round(el.currentTime/el.duration*1000);
    $("currentTime").textContent=fmt(el.currentTime);$("totalTime").textContent=fmt(el.duration);
    $("miniProgress").style.width=`${el.currentTime/el.duration*100}%`;
    if("mediaSession" in navigator && navigator.mediaSession.setPositionState){try{navigator.mediaSession.setPositionState({duration:el.duration,playbackRate:el.playbackRate,position:el.currentTime});}catch{}}
  }
  function showQueue(){ $("queueContent").innerHTML=listHTML(currentList);$("queueDialog").showModal();}
  async function sharePlaylist(id){
    const p=playlists.find(x=>x.id===id);if(!p)return;
    const names=p.ids.map(id=>tracks.find(t=>t.id===id)?.title).filter(Boolean);
    const text=`Musicly playlist: ${p.name}\n\n${names.map((n,i)=>`${i+1}. ${n}`).join("\n")}\n\nOpen Musicly and add the same local audio files to listen.`;
    if(navigator.share){try{await navigator.share({title:p.name,text});}catch{}}
    else{await navigator.clipboard?.writeText(text);alert("Playlist list copied. You can paste it into WhatsApp.");}
  }

  $("addFilesBtn").onclick=()=>$("filePicker").click();
  $("addFolderBtn").onclick=()=>$("folderPicker").click();
  $("filePicker").onchange=e=>addFiles(e.target.files);
  $("folderPicker").onchange=e=>addFiles(e.target.files);
  $("mainNav").onclick=e=>{const b=e.target.closest("[data-view]");if(!b)return;activeView=b.dataset.view;activeFilter="all";render();};
  $("searchInput").oninput=render;
  $("quickFilters").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;activeFilter=b.dataset.filter;document.querySelectorAll(".filter-chip").forEach(x=>x.classList.toggle("active",x===b));render();};
  $("viewContent").onclick=e=>{
    const like=e.target.closest("[data-like]");if(like){const t=tracks.find(x=>x.id===like.dataset.like);t.liked=!t.liked;dbRequest("readwrite","put",t);render();return;}
    const share=e.target.closest("[data-share]");if(share){sharePlaylist(share.dataset.share);return;}
    const row=e.target.closest("[data-track]");if(row){const list=[...tracks],idx=list.findIndex(t=>t.id===row.dataset.track);playList(list,idx);return;}
    const card=e.target.closest("[data-album],[data-folder],[data-singer],[data-composer]");
    if(card){const [attr,val]=Object.entries(card.dataset).find(([k])=>["album","folder","singer","composer"].includes(k));const key={album:"album",folder:"folder",singer:"artist",composer:"composer"}[attr];const subset=tracks.filter(t=>(t[key]||"Unknown")===val);$("pageTitle").textContent=val;$("pageSubtitle").textContent=`${subset.length} tracks`; $("viewContent").innerHTML=listHTML(subset);currentList=subset;return;}
    const pl=e.target.closest("[data-playlist]");if(pl){const p=playlists.find(x=>x.id===pl.dataset.playlist);const subset=p.ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);playList(subset);return;}
  };
  $("createPlaylistBtn").onclick=()=>$("playlistDialog").showModal();
  $("savePlaylistBtn").onclick=()=>{const name=$("playlistName").value.trim();if(!name)return;playlists.push({id:uid(),name,ids:[]});localStorage.setItem("musicly-playlists",JSON.stringify(playlists));$("playlistName").value="";$("playlistDialog").close();render();};
  $("settingsBtn").onclick=()=>$("settingsDialog").showModal();
  $("eqToggle").onclick=()=>{eqOn=!eqOn;$("eqToggle").textContent=eqOn?"On":"Off";$("eqToggle").classList.toggle("on",eqOn);$("eqControls").classList.toggle("disabled",!eqOn);ensureAudioGraph().then(updateEffects);};
  ["bassRange","midRange","trebleRange"].forEach(id=>$(id).oninput=()=>ensureAudioGraph().then(updateEffects));
  $("spatialToggle").onclick=()=>{spatialOn=!spatialOn;$("spatialToggle").textContent=spatialOn?"On":"Off";$("spatialToggle").classList.toggle("on",spatialOn);ensureAudioGraph().then(startSpatial);};
  $("crossfadeToggle").onclick=()=>{crossfadeOn=!crossfadeOn;$("crossfadeToggle").textContent=crossfadeOn?"On":"Off";$("crossfadeToggle").classList.toggle("on",crossfadeOn);startCrossfadeMonitor();};
  $("crossfadeRange").oninput=e=>{$("crossfadeValue").textContent=`${e.target.value} sec`;crossfadeSeconds=Number(e.target.value);};
  $("playPauseBtn").onclick=playPause;$("miniPlay").onclick=playPause;$("previousBtn").onclick=previousTrack;$("miniPrevious").onclick=previousTrack;$("nextBtn").onclick=nextTrack;$("miniNext").onclick=nextTrack;
  $("back10Btn").onclick=()=>seekBy(-10);$("forward10Btn").onclick=()=>seekBy(10);
  $("shuffleBtn").onclick=()=>{shuffle=!shuffle;$("shuffleBtn").style.color=shuffle?"var(--green)":"";};
  $("repeatBtn").onclick=()=>{repeat=!repeat;$("repeatBtn").style.color=repeat?"var(--green)":"";};
  $("miniOpen").onclick=showNowPlaying;$("closeNowPlaying").onclick=()=>$("nowPlaying").classList.add("hidden");$("queueBtn").onclick=showQueue;
  $("seekBar").oninput=e=>{const el=audio[activeDeck];if(el.duration)el.currentTime=Number(e.target.value)/1000*el.duration;};
  audio.forEach(el=>{el.addEventListener("timeupdate",updateProgress);el.addEventListener("play",updatePlayButtons);el.addEventListener("pause",updatePlayButtons);});
  $("queueDialog").addEventListener("click",e=>{const r=e.target.closest("[data-track]");if(r){const i=currentList.findIndex(t=>t.id===r.dataset.track);if(i>=0){currentIndex=i;activeDeck=1-activeDeck;loadTrack(currentList[i],true);$("queueDialog").close();}}});

  async function init(){
    try{db=await openDB();tracks=await dbRequest("readonly","all");}catch(e){console.error(e);$("viewContent").innerHTML='<div class="empty-state"><strong>Local storage unavailable</strong>Please open Musicly in a supported browser with site storage enabled.</div>';}
    try{playlists=JSON.parse(localStorage.getItem("musicly-playlists")||"[]");}catch{playlists=[];}
    render();startCrossfadeMonitor();
    if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(console.warn);
    if("mediaSession" in navigator){navigator.mediaSession.setActionHandler("stop",()=>audio[activeDeck].pause());}
  }
  init();
})();
