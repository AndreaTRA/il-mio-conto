import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/password-login/handler.js';
const url='https://example.supabase.co';
const request=body=>new Request(url+'/functions/v1/password-login',{method:'POST',headers:{origin:'https://andreatra.github.io','content-type':'application/json'},body:JSON.stringify(body)});
test('username lookup is server-controlled and no admin credentials leave the function',async()=>{
 const calls=[];const handler=createHandler({url,anonKey:'public-key',serviceKey:'server-secret',fetcher:async(path,options)=>{
 calls.push({path,options});return Response.json(path.includes('/admin/')?{users:[{email:'owner@example.test',app_metadata:{login_username:'owner'}}]}:{access_token:'verified',refresh_token:'refresh',expires_in:3600,user:{id:'one',email:'owner@example.test',app_metadata:{login_username:'owner'}}});
 }});
 const response=await handler(request({action:'login',identifier:'OWNER',password:'test-password'}));
 assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes('server-secret'));assert.ok(!body.includes('test-password'));
 assert.equal(calls[0].options.headers.Authorization,'Bearer server-secret');
 assert.equal(calls[1].options.headers.Authorization,'Bearer public-key');
 assert.equal(JSON.parse(calls[1].options.body).email,'owner@example.test');
});
test('user-editable metadata cannot claim a login alias',async()=>{
 let loginEmail;const handler=createHandler({url,anonKey:'public-key',serviceKey:'server-secret',fetcher:async(path,options)=>{
 if(path.includes('/admin/'))return Response.json({users:[{email:'attacker@example.test',user_metadata:{login_username:'owner'}}]});
 loginEmail=JSON.parse(options.body).email;return Response.json({code:'invalid_credentials'},{status:400});
 }});
 const response=await handler(request({action:'login',identifier:'owner',password:'test-password'}));
 assert.equal(response.status,401);assert.notEqual(loginEmail,'attacker@example.test');
});
test('untrusted origins and repeated password attempts are rejected',async()=>{
 const handler=createHandler({url,anonKey:'public-key',serviceKey:'server-secret',now:()=>100,fetcher:async path=>Response.json(path.includes('/admin/')?{users:[]}:{},{status:path.includes('/admin/')?200:400})});
 const blocked=await handler(new Request(url,{method:'POST',headers:{origin:'https://attacker.test'},body:'{}'}));assert.equal(blocked.status,403);
 for(let i=0;i<8;i++)await handler(request({action:'login',identifier:'owner',password:'test-password'}));
 assert.equal((await handler(request({action:'login',identifier:'owner',password:'test-password'}))).status,429);
});
test('password recovery never discloses account existence',async()=>{
 const handler=createHandler({url,anonKey:'public-key',serviceKey:'server-secret',fetcher:async path=>Response.json(path.includes('/admin/')?{users:[]}:{error:'not found'},{status:path.includes('/admin/')?200:400})});
 const response=await handler(request({action:'recover',identifier:'unknown-owner'}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});
test('numeric Auth status codes do not hide the email confirmation requirement',async()=>{
 const handler=createHandler({url,anonKey:'public-key',serviceKey:'server-secret',fetcher:async()=>Response.json({code:400,error_code:'email_not_confirmed'},{status:400})});
 const response=await handler(request({action:'login',identifier:'owner@example.test',password:'test-password'}));
 assert.equal(response.status,401);assert.equal((await response.json()).code,'email_not_confirmed');
});
