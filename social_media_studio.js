/* Omni Suite — Social Media Media Downloader
 * Browser-first: downloads direct, user-authorized media URLs.
 * Platform page URLs are detected for guidance but are not scraped or bypassed.
 */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const input = $('socialMediaUrl');
  const analyze = $('socialMediaAnalyze');
  const reset = $('socialMediaReset');
  const result = $('socialMediaResult');
  const status = $('socialMediaStatus');
  const preview = $('socialMediaPreview');
  const platform = $('socialMediaPlatform');
  const kind = $('socialMediaKind');
  const fileMeta = $('socialMediaMeta');
  const download = $('socialMediaDownload');
  const open = $('socialMediaOpen');
  const directHint = $('socialMediaDirectHint');

  if(!input || !analyze) return;

  const platforms = [
    ['youtube.com','YouTube'],['youtu.be','YouTube'],
    ['instagram.com','Instagram'],['facebook.com','Facebook'],['fb.watch','Facebook'],
    ['tiktok.com','TikTok'],['x.com','X / Twitter'],['twitter.com','X / Twitter'],
    ['pinterest.com','Pinterest'],['pin.it','Pinterest'],['reddit.com','Reddit'],
    ['linkedin.com','LinkedIn'],['threads.net','Threads'],['snapchat.com','Snapchat'],
    ['telegram.me','Telegram'],['t.me','Telegram'],['twitch.tv','Twitch'],
    ['vimeo.com','Vimeo'],['dailymotion.com','Dailymotion'],['tumblr.com','Tumblr'],
    ['bsky.app','Bluesky'],['mastodon.social','Mastodon'],['discord.com','Discord'],
    ['weibo.com','Weibo'],['likee.video','Likee'],['rumble.com','Rumble']
  ];

  function detectPlatform(url){
    try{
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./,'');
      const hit = platforms.find(([domain]) => host === domain || host.endsWith('.'+domain));
      return hit ? hit[1] : 'Web / Direct Media';
    }catch(_){ return 'Unknown'; }
  }

  function looksDirect(url){
    try{
      const p = new URL(url).pathname.toLowerCase();
      return /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|heif|mp4|webm|mov|m4v|avi|mkv|mpeg|mpg|3gp|m3u8|mp3|wav|m4a|aac|ogg|opus)(?:$|[?#])/.test(p);
    }catch(_){ return false; }
  }

  function safeName(url, type){
    try{
      const u = new URL(url);
      const base = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'omni-media');
      if(/\.[a-z0-9]{2,5}$/i.test(base)) return base.split('?')[0];
      const ext = type && type.includes('/') ? type.split('/')[1].split(';')[0] : 'bin';
      return 'omni-media.' + ext.replace('jpeg','jpg').replace('quicktime','mov');
    }catch(_){ return 'omni-media.bin'; }
  }

  function resetUI(){
    result.style.display='none';
    preview.innerHTML='';
    preview.className='social-preview empty';
    status.textContent='Paste a social post URL or a direct image/video URL.';
    status.className='social-status';
    platform.textContent='—'; kind.textContent='—'; fileMeta.textContent='—';
    download.style.display='none';
    open.style.display='none';
    directHint.style.display='none';
    input.value='';
  }

  async function analyzeUrl(){
    const value=input.value.trim();
    if(!value){ status.textContent='Paste a URL first.'; status.className='social-status error'; return; }
    let url;
    try{ url=new URL(value); if(!/^https?:$/.test(url.protocol)) throw new Error('Only HTTP/HTTPS URLs are supported.'); }
    catch(e){ status.textContent=e.message || 'Invalid URL.'; status.className='social-status error'; return; }

    const p=detectPlatform(value);
    platform.textContent=p;
    result.style.display='block';
    open.href=value; open.style.display='inline-flex';
    download.style.display='none';
    preview.innerHTML='';
    preview.className='social-preview empty';
    status.className='social-status working';
    status.textContent='Checking whether this URL exposes downloadable media directly…';

    if(!looksDirect(value)){
      kind.textContent='Social / page URL';
      fileMeta.textContent='Platform page detected';
      directHint.style.display='block';
      status.className='social-status warn';
      status.textContent = p + ' detected. This browser-only studio cannot reliably extract protected media from a platform page. Paste the direct media/CDN URL when the platform provides one, or use its official save/download control.';
      return;
    }

    try{
      const head=await fetch(value,{method:'HEAD',mode:'cors',cache:'no-store'});
      const type=(head.headers.get('content-type')||'').toLowerCase();
      if(!head.ok) throw new Error('HTTP '+head.status);
      if(!(type.startsWith('image/')||type.startsWith('video/')||type.startsWith('audio/'))){
        throw new Error('The server did not identify this as image/video/audio media.');
      }
      kind.textContent=type.startsWith('image/')?'Image':type.startsWith('video/')?'Video':'Audio';
      const size=head.headers.get('content-length');
      fileMeta.textContent=(size ? (Number(size)/1048576).toFixed(2)+' MB' : 'Size unavailable')+' • '+type;
      if(type.startsWith('image/')){
        const img=document.createElement('img'); img.src=value; img.alt='Media preview'; img.loading='lazy'; preview.appendChild(img);
      }else if(type.startsWith('video/')){
        const v=document.createElement('video'); v.src=value; v.controls=true; v.playsInline=true; preview.appendChild(v);
      }else{
        const a=document.createElement('audio'); a.src=value; a.controls=true; preview.appendChild(a);
      }
      preview.className='social-preview';
      download.style.display='inline-flex';
      download.onclick=()=>downloadDirect(value,type);
      status.className='social-status ok';
      status.textContent='Direct media URL detected. Ready to download in the browser.';
    }catch(e){
      kind.textContent='Media URL';
      fileMeta.textContent='Browser access blocked or unavailable';
      directHint.style.display='block';
      status.className='social-status warn';
      status.textContent='The URL looks like media, but the host does not allow browser access from this page (CORS or hotlink protection). Try the platform’s official download/save option or a direct media URL that permits browser access.';
    }
  }

  async function downloadDirect(url,type){
    download.disabled=true; download.textContent='Preparing…';
    try{
      const r=await fetch(url,{mode:'cors',cache:'no-store'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const blob=await r.blob();
      if(!blob.size) throw new Error('Empty media response.');
      const a=document.createElement('a');
      const u=URL.createObjectURL(blob);
      a.href=u; a.download=safeName(url,type||blob.type); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(u),60000);
      status.className='social-status ok'; status.textContent='Download started.';
    }catch(e){
      status.className='social-status error';
      status.textContent='Browser download failed: '+(e.message||e)+'. The source may require its official download flow.';
    }finally{
      download.disabled=false; download.textContent='⬇ Download Media';
    }
  }

  analyze.addEventListener('click',analyzeUrl);
  reset.addEventListener('click',resetUI);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')analyzeUrl();});
  resetUI();
  window.OMNI_SOCIAL_MEDIA_DOWNLOADER={analyze:analyzeUrl,detectPlatform};
})();
