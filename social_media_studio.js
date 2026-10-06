/* Omni Suite — Social Media Download Studio
 * Browser-first public-page resolver + direct media + optional Local Engine fallback.
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

  const input=$('socialMediaUrl'), analyzeBtn=$('socialMediaAnalyze'), reset=$('socialMediaReset');
  const REMOTE_READER='https://r.jina.ai/';
  let RESOLVER=(window.OMNI_SOCIAL_RESOLVER_URL||'https://omni-social-resolver.onrender.com').replace(/\/+$/,'');
  function cleanMediaUrl(v){return String(v||'').replace(/\\u0026/g,'&').replace(/\\u003d/g,'=').replace(/\\u002f/g,'/').replace(/\\\\\//g,'/').replace(/&amp;/g,'&').trim().replace(/^["']|["']$/g,'');}
  function findMediaUrls(text,base){
    const out=[]; const addUrl=v=>{v=cleanMediaUrl(v);if(v.startsWith('http')&&!out.includes(v))out.push(v);};
    const doc=new DOMParser().parseFromString(String(text||''),'text/html');
    doc.querySelectorAll('meta[property="og:video"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"],meta[property="og:image"],meta[name="twitter:image"]').forEach(e=>addUrl(e.getAttribute('content')));
    doc.querySelectorAll('video source,video,audio source,audio').forEach(e=>addUrl(e.getAttribute('src')));
    const raw=String(text||'');
    [/["']video_url["']\s*:\s*["']([^"']+)/i,/["']display_url["']\s*:\s*["']([^"']+)/i,/["']url["']\s*:\s*["'](https?:\/\/[^"']+)/i].forEach(re=>{const m=raw.match(re);if(m)addUrl(m[1]);});
    return out.map(v=>{try{return new URL(v,base).href}catch(_){return v;}});
  }
  async function hostedResolve(url){
    if(!RESOLVER)throw new Error('Hosted resolver is not configured.');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),90000);
    try{
      const r=await fetch(RESOLVER+'/api/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),cache:'no-store',signal:controller.signal});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.success)throw new Error(j.detail||j.error||('Resolver HTTP '+r.status));
      return j;
    }catch(e){
      if(e&&e.name==='AbortError')throw new Error('Hosted resolver timed out after 90 seconds');
      throw e;
    }finally{
      clearTimeout(timer);
    }
  }
  function renderHosted(info,sourceUrl){
    currentInfo=info;currentUrl=sourceUrl;
    platform.textContent=detect(sourceUrl);
    kind.textContent=info.type==='video'?'Video':'Media';
    meta.textContent=info.title||'Public media';
    const seconds=Math.round(Number(info.duration)||0);
    const dur=seconds?new Date(seconds*1000).toISOString().substr(11,8):'—';
     const downloads=Array.isArray(info.downloads)?info.downloads:[];
     const itemUrls=downloads.map(d=>String(d.url||'')).filter(Boolean).map(u=>u.startsWith('http')?u:RESOLVER+u);
     const mediaKind=(d)=>{
       const ext=String(d.ext||'').toLowerCase().replace(/^\./,'');
       if(ext)return ext;
       const u=String(d.url||'').split('?')[0].toLowerCase();
       const m=u.match(/\.(jpe?g|png|webp|avif|gif|mp4|webm|mov|m4v|m3u8|mp3|m4a|aac|ogg)$/);
       return m?m[1]:'media';
     };
     const mediaLabel=(d)=>{
       const ext=mediaKind(d);
       return ext==='jpg'||ext==='jpeg'?'JPG':ext==='png'?'PNG':ext==='webp'?'WEBP':ext==='avif'?'AVIF':ext==='gif'?'GIF':ext==='mp4'?'MP4':ext==='webm'?'WEBM':ext==='mov'?'MOV':ext==='m4v'?'M4V':ext==='m3u8'?'HLS':ext==='mp3'?'MP3':ext==='m4a'?'M4A':ext==='aac'?'AAC':ext==='ogg'?'OGG':'MEDIA';
     };
     const isVideo=(d)=>{
       const ext=mediaKind(d);
       return /^(mp4|webm|mov|m4v|m3u8)$/.test(ext)||d.has_audio===true;
     };
     if(info.type==='carousel' && itemUrls.length>1){
       preview.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;width:100%">'+
         downloads.map((d,i)=>{
           const u=itemUrls[i]; const esc=String(u).replace(/"/g,'&quot;');
           const label=mediaLabel(d);
           const media=isVideo(d)
             ? '<video src="'+esc+'" controls playsinline preload="metadata" style="display:block;width:100%;aspect-ratio:4/5;object-fit:contain;background:#111"></video>'
             : '<img src="'+esc+'" alt="Post item '+(i+1)+'" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;aspect-ratio:4/5;object-fit:contain;background:#f6f3ff">';
           return '<div style="border:1px solid rgba(108,92,255,.14);border-radius:12px;overflow:hidden;background:#fff">'+media+'<div style="padding:7px 9px;font-size:.7rem;font-weight:800;color:#4b466f">Item '+(i+1)+' · '+label+'</div></div>';
         }).join('')+
       '</div>';
     }else{
       const first=downloads[0]; const firstUrl=itemUrls[0]||info.thumbnail; const esc=String(firstUrl||'').replace(/"/g,'&quot;');
       preview.innerHTML=firstUrl?(first&&isVideo(first)?'<video src="'+esc+'" controls playsinline preload="metadata" style="max-width:100%;max-height:430px"></video>':'<img src="'+esc+'" alt="Media preview" loading="lazy" referrerpolicy="no-referrer">'):'<div style="padding:28px;text-align:center"><strong>Media ready</strong><br><span style="font-size:.78rem;color:#7b8795">Choose a download below.</span></div>';
     }
     preview.className='social-preview';
    const buttons=(info.downloads||[]).map(d=>{
      const href=String(d.url||'').startsWith('http')?d.url:RESOLVER+d.url;
      const ext=String(d.ext||'').toLowerCase().replace(/^\./,'');
      const label=ext==='jpg'||ext==='jpeg'?'JPG':ext==='png'?'PNG':ext==='webp'?'WEBP':ext==='avif'?'AVIF':ext==='gif'?'GIF':ext==='mp4'?'MP4':ext==='webm'?'WEBM':ext==='mov'?'MOV':ext==='m4v'?'M4V':ext==='m3u8'?'HLS':ext==='mp3'?'MP3':ext==='m4a'?'M4A':ext==='aac'?'AAC':ext==='ogg'?'OGG':'MEDIA';
      return '<a href="'+String(href).replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin-top:7px;border:1px solid rgba(108,92,255,.14);border-radius:12px;background:#fff;color:#1c1b3a;text-decoration:none;font-weight:800;font-size:.76rem"><span>'+String(d.quality||'Best')+'<small style="display:block;color:#7b8795;font-weight:500;margin-top:2px">'+label+' • Browser download</small></span><b style="padding:7px 11px;border-radius:9px;background:linear-gradient(120deg,#6c5cff,#ff4f9a);color:#fff;font-size:.7rem">Download</b></a>';
    }).join('');
    hint.style.display='block';hint.className='social-direct-hint social-direct-ok';
    hint.innerHTML='<b>✓ Public content</b> &nbsp; ✓ No login required &nbsp; ✓ Browser download'+
      '<div style="margin-top:12px;font-weight:800;color:#1c1b3a">Available downloads</div>'+
      (buttons||'<div style="margin-top:6px">No downloadable public format was returned.</div>')+
      '<div style="margin-top:10px;color:#7b8795">Creator: '+String(info.uploader||'Public creator')+' • Duration: '+dur+'</div>';
    setButtons(false);msg('Public media found. Choose a download below.','ok');
  }

  async function browserResolve(url){
    const target=url.split('#')[0];
    const r=await fetch(REMOTE_READER+target,{cache:'no-store'});
    if(!r.ok)throw new Error('Browser resolver HTTP '+r.status);
    const text=await r.text(); const urls=findMediaUrls(text,target);
    if(!urls.length)throw new Error('No public media URL found');
    const media=urls.find(u=/\.(mp4|webm|mov|m4v|mp3|m4a|aac|ogg)([?#]|$)/i.test(u))||urls[0];
    const thumb=urls.find(u=/\.(jpe?g|png|webp|avif)([?#]|$)/i.test(u))||'';
    return {mediaUrl:media,thumbnail:thumb};
  }

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
  async function runAnalyze(){
    const url=input.value.trim();
    if(!url){msg('Paste a URL first.','error');return;}
    try{new URL(url);}catch(_){msg('That is not a valid URL.','error');return;}
    currentUrl=url;platform.textContent=detect(url);result.style.display='block';open.href=url;setButtons(false);
    msg('Resolving public media…','working');preview.innerHTML='<div style="padding:28px">Finding public media…</div>';preview.className='social-preview empty';
    try{
      const info=await hostedResolve(url); renderHosted(info,url); return;
    }catch(e){console.warn('[Social Media Studio] Hosted resolver:',e);}
    try{
      const x=await browserResolve(url); currentUrl=x.mediaUrl;
      kind.textContent=/\.(mp4|webm|mov|m4v|mp3|m4a|aac|ogg)([?#]|$)/i.test(x.mediaUrl)?'Video / Audio':'Image / Media';
      meta.textContent='Public media • Browser Resolver'; preview.innerHTML='';
      if(x.thumbnail){const img=document.createElement('img');img.src=x.thumbnail;img.alt='Media preview';img.loading='lazy';preview.appendChild(img);}else preview.innerHTML='<div style="padding:28px;text-align:center"><strong>Public media found</strong><br><span style="font-size:.78rem;color:#7b8795">Ready for browser download.</span></div>';
      preview.className='social-preview';hint.style.display='block';hint.innerHTML='<b>Browser mode active.</b> Public media resolved without the Local Engine. Private, login-only and DRM content is not supported.';
      setButtons(true);download.textContent='⬇ Download Media';download.onclick=()=>downloadDirectResolved(x.mediaUrl);msg('Public media found. Ready to download.','ok');return;
    }catch(e){console.warn('[Social Media Studio] Direct browser resolver:',e);}
    try{
      await localHealth(); const info=await localJob({op:'social_download',url,info_only:true}); currentUrl=url;renderInfo(info);msg('Media detected by Local Engine.','ok');setButtons(true);download.textContent='⬇ Download Best';download.onclick=()=>downloadWithMode('best','best');return;
    }catch(e){console.warn('[Social Media Studio] Local Engine unavailable:',e);}
    if(await analyzeDirect(url))return;
    currentUrl=url;kind.textContent='Social / page URL';meta.textContent='No public media link found';hint.style.display='block';hint.innerHTML='<b>Could not resolve this public page.</b> It may be private, login-gated, blocked, or temporarily unsupported.';msg('No public media URL could be resolved in browser mode.','warn');
  }
  async function downloadDirectResolved(url){
    download.disabled=true;download.textContent='Downloading…';msg('Downloading through the browser…','working');
    try{const r=await fetch(url,{mode:'cors',cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.blob();const ext=(b.type.split('/')[1]||'bin').split(';')[0];const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='omni-social-media.'+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);msg('Download started.','ok');}
    catch(e){window.open(url,'_blank','noopener,noreferrer');msg('The CDN blocked browser file access. Opened the resolved media URL; use the browser Save/Download control.','warn');}
    finally{download.disabled=false;download.textContent='⬇ Download Media';}
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
  analyzeBtn?.addEventListener('click',runAnalyze);
  reset?.addEventListener('click',resetUI);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')runAnalyze();});
  // Expose a small test hook for Validation Lab.
  window.OMNI_SOCIAL_MEDIA_DOWNLOADER={analyze:runAnalyze,detect,downloadWithMode};
  resetUI();
})();