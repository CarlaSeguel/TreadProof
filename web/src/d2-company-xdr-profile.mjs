// Structural profile only. Server composition + fresh Auth/HIGH1 remain mandatory.
export const COMPANY_XDR600_PROFILE='d2_company_create_batch_1000g_600s';
export function company600Scope(profile,action,role,mass,network){
 return profile===COMPANY_XDR600_PROFILE&&action==='create_batch'&&role==='company'&&mass==='1000'&&network==='Test SDF Network ; September 2015';
}
export function xdrProfileFields(value){return value.xdrProfile===undefined?{}:{xdrProfile:value.xdrProfile};}
