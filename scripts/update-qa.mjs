// Reproduce a legacy cache that cannot display its update banner. Local only.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
let repaired=false;
const style='<style>body{background:#100f17;color:#f5f1fc;font:18px system-ui;padding:36px;max-width:720px}button,a{display:inline-block;padding:14px;margin:12px 12px 12px 0;background:#8343ef;color:white;border:0;border-radius:8px;font:inherit}p{line-height:1.8}</style>';
const oldHtml=`<!doctype html><html lang="it"><meta charset="utf-8"><title>Prova recupero Flowly</title>${style}<h1>Versione precedente</h1><p id="status">Avvio della vecchia cache…</p><p>Simulazione senza dati personali: il vecchio aggiornamento non mostra alcun avviso.</p><button id="publish">Pubblica la correzione di prova</button><a href="?aggiorna=1#backup">Apri il recupero</a><script src="legacy.js"></script></html>`;
const oldJs=`(async()=>{if(!('serviceWorker' in navigator)){document.querySelector('#status').textContent='Service worker non disponibile';return;}localStorage.setItem('update-qa-record',localStorage.getItem('update-qa-record')||'saldo-dimostrativo-1234');const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});await navigator.serviceWorker.ready;const report=()=>document.querySelector('#status').textContent=navigator.serviceWorker.controller?'Vecchia versione pronta e controllata dalla cache':'In attesa del controllo della cache';report();navigator.serviceWorker.addEventListener('controllerchange',report);document.querySelector('#publish').onclick=async()=>{await fetch('publish-repair',{method:'POST'});document.querySelector('#status').textContent='Correzione pubblicata. Apri il recupero.';};})().catch(e=>document.querySelector('#status').textContent=e.message);`;
const oldWorker=`const cacheName='conto-shell:/:legacy';self.addEventListener('install',e=>e.waitUntil(caches.open(cacheName).then(c=>c.addAll(['./','./legacy.js']))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;if(e.request.mode==='navigate')e.respondWith(caches.open(cacheName).then(c=>c.match('./')).then(r=>r||fetch(e.request)));else if(u.pathname==='/legacy.js')e.respondWith(caches.open(cacheName).then(c=>c.match('./legacy.js')).then(r=>r||fetch(e.request)));});self.addEventListener('message',e=>{if(e.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});`;
const newHtml=`<!doctype html><html lang="it"><meta charset="utf-8"><title>Prova recupero Flowly</title>${style}<h1>Versione aggiornata</h1><p id="result"></p><p id="url"></p><script>document.querySelector('#result').textContent=localStorage.getItem('update-qa-record')==='saldo-dimostrativo-1234'?'Dati conservati: prova di recupero riuscita.':'Errore: dato dimostrativo mancante';document.querySelector('#url').textContent='Pagina aperta: '+location.hash;</script></html>`;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(req.method==='POST'&&pathname==='/publish-repair'){repaired=true;res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ready":true}');return;}
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 let content,type='text/javascript';
 if(pathname==='/'||pathname==='/index.html'){content=repaired?newHtml:oldHtml;type='text/html';}
 else if(pathname==='/legacy.js')content=oldJs;
 else if(pathname==='/service-worker.js')content=repaired?(await fs.readFile(path.join(root,'service-worker.js'),'utf8')).replace('__APP_VERSION__','repair-regression'):oldWorker;
 else{const file=path.resolve(root,'.'+pathname);if(path.relative(root,file).startsWith('..'))throw Error('Path');content=await fs.readFile(file);type=types[path.extname(file)]||'application/octet-stream';}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(content);
}catch{res.writeHead(404);res.end('Not found');}});
const port=Number(process.env.CONTO_UPDATE_QA_PORT||8794);
server.listen(port,'127.0.0.1',()=>console.log('Prova vecchia cache: http://localhost:'+port+'/')); 
