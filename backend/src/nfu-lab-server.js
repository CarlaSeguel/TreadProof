// Dedicated loopback lab; no real Supabase gateway, wallets, SDK server or upstream fetch.
import {makeServer} from './server.js';
import {createLabStore} from './nfu-lab-store.js';
import {createLabIdentity,createLabModel} from './nfu-lab-model.js';
import {createNfuHttpService} from './nfu-http-service.js';
export function createNfuLabServer({file=null,now=Date.now,decorateModel=value=>value}={}){
 const store=createLabStore({file}),identity=createLabIdentity({now}),model=decorateModel(createLabModel({store,identity,now}));
 const nfuService=createNfuHttpService({model,store,now});
 const server=makeServer({config:identity.config,gateway:model.gateway,authClient:identity.authClient,authOnly:true,
  trustedOrigins:['http://127.0.0.1:5173','http://127.0.0.1:4173'],
  allowedHosts:['127.0.0.1:3002','127.0.0.1:5173','127.0.0.1:4173'],nfuService,rateLimit:300});
 server.once('close',()=>{void store.close();});
 return {server,store,model,nfuService};
}
