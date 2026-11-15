// TB Wetter – Offline-Hülle. Wetterdaten selbst liegen im localStorage der App.
const V='tbw-2.0', SHELL=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  if(u.origin===location.origin){ // App: erst Netz (Updates), sonst Cache
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
  } else if(u.hostname.endsWith('fonts.gstatic.com')||u.hostname.endsWith('fonts.googleapis.com')||u.hostname==='tile.openstreetmap.org'){ // Schriften & Kartenkacheln: Cache zuerst
    e.respondWith(caches.open(V+'-ext').then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(n=>{if(n.ok||n.type==='opaque'){c.put(e.request,n.clone());trim(c);}return n;}))));
  }
});

// Kartenkacheln begrenzen, damit der Speicher nicht wächst
function trim(c){c.keys().then(k=>{if(k.length>400)k.slice(0,k.length-400).forEach(r=>c.delete(r));});}

// Push-Nachrichten empfangen und anzeigen (auch auf der Apple Watch, wenn das iPhone gesperrt ist)
self.addEventListener('push',e=>{
  let d={}; try{ d=e.data?e.data.json():{}; }catch(x){ d={title:'TB Wetter',body:e.data?e.data.text():''}; }
  e.waitUntil(self.registration.showNotification(d.title||'TB Wetter',{body:d.body||'',tag:d.tag||'tbw',renotify:true,icon:'icon-192.png',badge:'icon-192.png',data:{view:d.view||'wetter'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close(); const view=(e.notification.data&&e.notification.data.view)||'wetter';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){ if('focus' in c){ c.postMessage({open:view}); return c.focus(); } }
    return self.clients.openWindow('./'+(view==='radar'?'#radar':''));
  }));
});
