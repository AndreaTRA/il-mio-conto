// Isolated UI preview. Never built or published; never contacts Supabase.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/', import.meta.url));
const mockCloud = `
import * as Storage from './storage.js';
import { emptyState } from './model.js';
const identity={projectUrl:'https://ui-preview.invalid',user:{id:'00000000-0000-4000-8000-000000000001',email:'demo@example.invalid'}};
export const session=async()=>identity;
export const requireApproved=async()=>({status:'approved',is_admin:true,email:'demo@example.invalid',first_name:'Anteprima',last_name:'dimostrativa'});
export const takeRedirectSession=async()=>null;
export const onCloudChange=()=>()=>{};
export const initializeCloud=async()=>{};
export const manageAccounts=async()=>[];
export const cloud={status:{phase:'synced',email:identity.user.email},running:null,async initialize(){let state=await Storage.load();if(!state.entries.length&&!state.accounts.length){const next=emptyState();next.settings={targetCents:5000000,deadline:'2030-12-31',goalChosen:true};next.entries=[{month:'2026-11',balanceCents:250000,note:'Dati dimostrativi'}];await Storage.save(next,state.revision);}},async trigger(){},async logout(){}};
let links=[];
export const walletLinks=async(action,accountId)=>{if(action==='create')links=[...links.filter(l=>l.accountId!==accountId),{accountId,createdAt:new Date().toISOString()}];if(action==='revoke')links=links.filter(l=>l.accountId!==accountId);return {links,token:action==='create'?'1'.repeat(64):null};};
export const sendCode=async()=>{};export const verifyCode=async()=>{};export const verifyEmailLink=async()=>{};export const acceptRedirectSession=async()=>{};export const signIn=async()=>{};export const requestPasswordRecovery=async()=>{};export const verifyRecoveryLink=async()=>{};export const resetPassword=async()=>{};export const register=async()=>{};export const updateProfile=async()=>{};export const changeEmail=async()=>{};
`;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{try{
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(path.relative(root,file).startsWith('..'))throw Error('path');
 let content=file===path.join(root,'cloud.js')?mockCloud:await fs.readFile(file);
 if(file===path.join(root,'index.html'))content=content.toString().replace('<body>','<body><p style="padding:10px 20px;background:#302044;color:#f5f1fc;font-size:12px">Anteprima locale · dati dimostrativi · nessun collegamento alla banca</p>');
 res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
}catch{res.writeHead(404);res.end('Not found');}});
server.listen(8793,'127.0.0.1',()=>console.log('Anteprima dimostrativa: http://localhost:8793/?dev=1'));
