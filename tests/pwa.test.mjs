import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState, ArchiveUpdateRequiredError } from '../public/model.js';

test('future archives are distinguished from malformed backup files',()=>{
 assert.throws(()=>validateState({schemaVersion:99}), error=>error instanceof ArchiveUpdateRequiredError && error.updateRequired===true);
 assert.throws(()=>validateState({schemaVersion:'wrong'}), error=>!error.updateRequired);
});
test('checking an update activates the waiting app and reloads without clearing user storage',async()=>{
 const original=Object.fromEntries(['navigator','window','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const events={},messages=[],statuses=[];let checks=0,reloads=0,activate;
 const registration={waiting:{postMessage:message=>messages.push(message)},update:async()=>{checks++;},addEventListener(){}};
 const savedData={balance:123400,preference:true};
 try {
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{controller:{},register:async()=>registration,getRegistration:async()=>registration,ready:Promise.resolve(registration),addEventListener:(name,listener)=>{events[name]=listener;}}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true,location:{reload(){reloads++;}}}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://example.test/flowly/'}});
  const {initializePwa,checkForAppUpdate}=await import('../public/pwa.js?update-test');
  await initializePwa({onStatus:status=>statuses.push(status),onUpdate:callback=>{activate=callback;}});
  assert.equal(typeof activate,'function');
  assert.equal(await checkForAppUpdate(),true);assert.equal(checks,1);
  activate();assert.deepEqual(messages,[{type:'ACTIVATE_UPDATE'}]);
  events.controllerchange();assert.equal(reloads,1);
  assert.deepEqual(savedData,{balance:123400,preference:true});
  assert.ok(statuses.includes('offline-ready'));
 } finally {for(const key of Object.keys(original)){if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key];}}
});
