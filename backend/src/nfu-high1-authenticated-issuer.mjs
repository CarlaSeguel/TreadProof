import {preparationStage} from './nfu-preparation-diagnostics.js';
import {createNfuGrantIssuer} from './nfu-auth-grant-issuer.mjs';
import {authorizedContext,TOKEN} from './auth.js';
import {ApiError} from './validation.js';

export function createAuthenticatedHigh1Issuer({
  gateway,
  persistGrant,
  allowedOrigins=[
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173'
  ]
}={}) {
  if(typeof gateway!=='function' ||
     typeof persistGrant!=='function') {
    throw new Error('high1_authority_not_configured');
  }

  const issuer=createNfuGrantIssuer({
    persistGrant:grant=>preparationStage('high1_grant_persist','body',()=>persistGrant(grant)),
    resolveIdentity:credential=>preparationStage('high1_identity','identity',async()=>{
      const {token,origin,authorization}=credential??{};

      if(typeof token!=='string' ||
         !TOKEN.test(token) ||
         !allowedOrigins.includes(origin)) {
        throw new ApiError(401,'authentication_required');
      }

      if(authorization?.source!=='validated_auth_user_and_rls') {
        throw new ApiError(403,'authorization_required');
      }

      const db=gateway(token);
      const user=await db.user();
      const context=await authorizedContext(db,user);

      if(context.user.id!==authorization.userId ||
         context.organization.id!==authorization.organizationId) {
        throw new ApiError(403,'authorization_context_changed');
      }

      if(authorization.role!==undefined&&authorization.role!==context.organization.organization_type)throw new ApiError(403,'transaction_role_not_authorized');

      return {
        verified:true,
        userId:context.user.id,
        organizationId:context.organization.id
      };
    })
  });

  return async function issueGrant({
    credential,
    authorization,
    operation,
    request
  }={}) {
    return issuer.issue({
      credential:{
        token:credential?.token,
        origin:credential?.origin,
        authorization
      },
      operation,
      request
    });
  };
}
