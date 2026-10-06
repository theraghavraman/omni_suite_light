/* Omni Suite — Social Media Download Studio
 * Browser-first direct media + Local Engine (yt-dlp) fallback.
 * The Local Engine does not use DRM bypass, credential harvesting or
 * platform-login automation.
 */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const BASE='http://127.0.0.1:8765';
  let token='';
  let currentUrl='';
  let currentInfo=null;

  const input=$('socialMediaUrl'), analyze=$('socialMediaAnalyze'), reset=$('socialMediaReset');
  const result=$('socialMediaResult'), status=$('socialMediaStatus'), preview=$('socialMediaPreview');
  const platform=$('socialMediaPlatform'), kind=$('socialMediaKind'), meta=$('socialMediaMeta');
  const download=$('socialMediaDownload'), open=$('socialMediaOpen'), hint=$('socialMediaDirectHint');

  const platforms=[
    ['youtube.com','YouTube'],['youtu.be','YouTube'],['instagram.com','Instagram'],
    ['facebook.com','Facebook'],['fb.watch','Facebook'],['tiktok.com','TikTok'],
    ['x.com','X / Twitter'],['twitter.com','X / Twitter'],['pinterest.com','Pinterest'],
    ['pin.it','Pinterest'],['reddit.com','Reddit'],['linkedin.com','LinkedIn'],
    ['threads.net','Threads'],['threads.com','Threads'],['snapchat.com','Snapchat'],
    ['telegram.me','Telegram'],['t.me','Telegram'],['twitch.tv','Twitch'],
    ['vimeo.com','Vimeo'],['dailymotion.com','Dailymotion'],['tumblr.com','Tumblr'],
    ['bsky.app','Bluesky'],['mastodon.social','Mastodon'],['weibo.com','Weibo'],
    ['likee.video','Likee'],['rumble.com','Rumble']
  ];

  function detect(url){
    try{
      const h=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
      return (platforms.find(x=>h===x[0]||h.endsWith('.'+x[0]))||[])[1]||'Web / Direct Media';
    }catch(_){return 'Unknown';}
  }
  function direct(url){
    try{return /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|heif|mp4|webm|mov|m4v|avi|mkv|mpeg|mpg|3gp|mp3|wav|m4a|aac|ogg|opus)(?:$|[?#])/i.test(new URL(url).pathname);}
    catch(_){return false;}
  }
  function msg(text,cls){status.textContent=text;status.className='social-status '+(cls||'');}
  function setButtons(showDownload){
    if(download)download.style.display=showDownload?'inline-flex':'none';
    if(open)open.style.display=currentUrl?'inline-flex':'none';
  }
  function resetUI(){
    currentUrl='';currentInfo=null;
    result.style.display='none';preview.innerHTML='';preview.className='social-preview empty';
    platform.textContent='—';kind.textContent='—';meta.textContent='—';
    setButtons(false);hint.style.display='none';msg('Paste a social post URL or a direct image/video URL.');
    input.value='';
  }
  async function localHealth(){
    const r=await fetch(BASE+'/api/health',{cache:'no-store'});
    if(!r.ok)throw new Error('Local Engine HTTP '+r.status);
    const j=await r.json();
    if(Number(j.engine_api_version||0)<4)throw new Error('Outdated Local Engine. Restart the current Omni Suite Local Engine.');
    token=j.token||token;
    if(!j.tools?.['yt-dlp']?.installed)throw new Error('Social downloader engine (yt-dlp) is not installed. Run the current Omni Suite setup once.');
    return j;
  }
  async function localJob(payload){
    const r=await fetch(BASE+'/api/process',{method:'POST',headers:{'Origin':location.origin,'X-Omni-Token':token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||('Local Engine HTTP '+r.status));
    return j;
  }
  function renderInfo(info){
    currentInfo=info;
    kind.textContent=info.extractor||detect(currentUrl);
    const dur=info.duration?(' • '+Math.round(info.duration)+'s'):'';
    meta.textContent=(info.uploader||'Public media')+dur;
    preview.innerHTML='';
    if(info.thumbnail){
      const img=document.createElement('img');img.src=info.thumbnail;img.alt='Media thumbnail';img.loading='lazy';preview.appendChild(img);
    }else{
      preview.innerHTML='<div style="padding:28px;text-align:center"><strong>Media found</strong><br><span style="font-size:.78rem;color:#7b8795">Ready to download with Local Engine.</span></div>';
    }
    preview.className='social-preview';
    hint.style.display='block';
    hint.innerHTML='<b>Local Engine active.</b> Omni will download the media through the local engine instead of trying to bypass browser CORS restrictions.';
  }
  async function analyzeDirect(url){
    try{
      const h=await fetch(url,{method:'HEAD',mode:'cors',cache:'no-store'});
      const type=(h.headers.get('content-type')||'').toLowerCase();
      if(!h.ok||!/^((image|video|audio)\/)\b/.test(type))throw new Error('Not a browser-accessible direct media URL');
      kind.textContent=type.startsWith('image/')?'Image':type.startsWith('video/')?'Video':'Audio';
      const size=h.headers.get('content-length');
      meta.textContent=size?(Number(size)/1048576).toFixed(2)+' MB':type;
      preview.innerHTML='';
      const el=type.startsWith('image/')?document.createElement('img'):type.startsWith('video/')?document.createElement('video'):document.createElement('audio');
      el.src=url;el.controls=type.startsWith('video/')||type.startsWith('audio/');el.playsInline=true;el.alt='Media preview';
      preview.appendChild(el);preview.className='social-preview';
      setButtons(true);hint.style.display='block';hint.textContent='Direct media URL detected. Browser download is available.';
      msg('Direct media detected. Ready to download.','ok');
      download.onclick=()=>downloadDirect(url,type);
      return true;
    }catch(_){return false;}
  }
  async function downloadDirect(url,type){
    download.disabled=true;download.textContent='Preparing…';
    try{
      const r=await fetch(url,{mode:'cors'});if(!r.ok)throw new Error('HTTP '+r.status);
      const b=await r.blob();const u=URL.createObjectURL(b),a=document.createElement('a');
      a.href=u;a.download='omni-media.'+(type.split('/')[1]||'bin');a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);
      msg('Download started.','ok');
    }catch(e){msg('Browser download failed: '+e.message+'. Use Local Engine if available.','error');}
    finally{download.disabled=false;download.textContent='⬇ Download Media';}
  }
  async function analyze(){
    const url=input.value.trim();
    if(!url){msg('Paste a URL first.','error');return;}
    try{new URL(url);}catch(_){msg('That is not a valid URL.','error');return;}
    currentUrl=url;platform.textContent=detect(url);result.style.display='block';open.href=url;setButtons(false);
    msg('Analyzing media…','working');preview.innerHTML='<div style="padding:28px">Checking source…</div>';preview.className='social-preview empty';
    // First try the Local Engine. This is the path that makes social URLs work from GitHub Pages.
    try{
      await localHealth();
      const info=await localJob({op:'social_download',url,info_only:true});
      renderInfo(info);
      msg('Media detected by Local Engine. Choose a download mode below.','ok');
      setButtons(true);
      download.textContent='⬇ Download Best';
      download.onclick=()=>downloadWithMode('best','best');
      return;
    }catch(e){
      console.warn('[Social Media Studio] Local Engine unavailable:',e);
    }
    if(await analyzeDirect(url))return;
    kind.textContent='Social / page URL';meta.textContent='Local Engine unavailable';
    hint.style.display='block';
    hint.innerHTML='<b>Local Engine is required for social-page URLs.</b> Start/restart the current Omni Suite Local Engine, then Analyze again. Direct media URLs can still work browser-only when the source permits CORS.';
    msg('This social page cannot be extracted by GitHub Pages alone. Start the Local Engine and try again.','warn');
  }
  async function downloadWithMode(mode,quality){
    download.disabled=true;download.textContent='Downloading…';msg('Local Engine is downloading the media…','working');
    try{
      await localHealth();
      const j=await localJob({op:'social_download',url:currentUrl,mode,quality});
      const d=await fetch(BASE+'/api/download/'+encodeURIComponent(j.file_id),{headers:{'Origin':location.origin,'X-Omni-Token':token}});
      if(!d.ok)throw new Error('Output download failed');
      const b=await d.blob(),u=URL.createObjectURL(b),a=document.createElement('a');
      a.href=u;a.download=j.name||'omni-social-media';document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(u),60000);msg('Download complete.','ok');
    }catch(e){msg(e.message||String(e),'error');}
    finally{download.disabled=false;download.textContent='⬇ Download Best';}
  }
  analyze?.addEventListener('click',analyze);
  reset?.addEventListener('click',resetUI);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')analyze();});
  // Expose a small test hook for Validation Lab.
  window.OMNI_SOCIAL_MEDIA_DOWNLOADER={analyze,detect,downloadWithMode};
  resetUI();
})();