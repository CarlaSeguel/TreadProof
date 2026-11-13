import { AUTH_MESSAGES, AuthError, createAuthApi, createAuthSession } from './auth-session.mjs';
import { mountAuthView } from './auth-view.mjs';
import { exportD3ReviewHtml, renderD3ReviewReport } from './d3-review-report.mjs';
import './style.css';
import './reviewer.css';

const root=document.querySelector('main');
const login=root.querySelector('[data-auth-form]');
const logout=root.querySelector('[data-logout]');
const batchForm=root.querySelector('[data-batch-form]');
const status=root.querySelector('[data-status]');
const results=root.querySelector('[data-results]');
const reportView=root.querySelector('[data-report]');
const evidenceButton=root.querySelector('[data-export="pdf"]');
let report=null,busy=false;
function clearReport(){
  report=null;
  reportView.replaceChildren();
  results.hidden=true;
}
function validateReviewer(context){
  if(context?.source!=='validated_d3_reviewer'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(context.user?.id??'')){
    throw new AuthError('invalid_auth_response');
  }
  return {user:{id:context.user.id},source:context.source};
}
const auth=createAuthSession(createAuthApi(fetch,{reviewer:true}),{contextValidator:validateReviewer,onChange(state){
  const active=state.status==='authenticated';
  login.hidden=active;
  login.querySelector('[data-login]').disabled=state.status==='signing_in';
  logout.hidden=!active;
  batchForm.hidden=!active;
  if(!active)clearReport();
  status.textContent=state.error?(AUTH_MESSAGES[state.error]??AUTH_MESSAGES.auth_unavailable):'';
}});
function download(body,type,name){
  const link=document.createElement('a');
  const url=URL.createObjectURL(new Blob([body],{type}));
  link.href=url;
  link.download=name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function perform(work){
  if(busy)return;
  busy=true;
  status.textContent='Comprobando permiso y fuente de datos…';
  try{await work();status.textContent='';}
  catch(error){
    clearReport();
    status.textContent=AUTH_MESSAGES[error.code]??'No se pudo completar la lectura autorizada.';
  }finally{busy=false;}
}
if(location.protocol==='https:'){
  login.hidden=false;
  mountAuthView(root,auth);
  const assigned=new URLSearchParams(location.search).get('batch');
  if(assigned)batchForm.elements.batch.value=assigned;
  batchForm.addEventListener('submit',event=>{
    event.preventDefault();
    void perform(async()=>{
      clearReport();
      const next=await auth.reviewRead(batchForm.elements.batch.value.trim(),'report');
      if(next?.schemaVersion!=='treadproof-nfu-review-v1')throw new AuthError('invalid_auth_response');
      reportView.innerHTML=renderD3ReviewReport(next);
      report=next;
      evidenceButton.hidden=!next.evidence;
      results.hidden=false;
    });
  });
  for(const button of root.querySelectorAll('[data-export]'))button.addEventListener('click',()=>{
    if(!report)return;
    void perform(async()=>{
      const current=report,kind=button.dataset.export;
      const name='treadproof-nfu-'+current.batch.id.value;
      if(kind==='pdf'){
        const result=await auth.reviewRead(current.batchUuid,'evidence/'+current.evidence.id);
        if(result?.sha256!==current.batch.evidenceSha256.value||result.byteSize!==current.evidence.byteSize||result.contentType!=='application/pdf'){
          throw new AuthError('evidence_integrity_mismatch');
        }
        const bytes=Uint8Array.fromBase64(result.content_base64);
        download(bytes,'application/pdf',name+'-evidencia.pdf');
      }else{
        const access=await auth.reviewRead(current.batchUuid,'access');
        if(access?.authorized!==true)throw new AuthError('d3_review_access_denied');
        if(kind==='json')download(JSON.stringify(current,null,2)+'\n','application/json',name+'.json');
        else download(exportD3ReviewHtml(current),'text/html;charset=utf-8',name+'.html');
      }
    });
  });
}else{
  status.textContent='El acceso del revisor requiere HTTPS.';
}
