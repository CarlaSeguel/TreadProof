import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export const authProxy={
 '/api/v1/nfu-preparations/create-batch': {
   target:'http://127.0.0.1:3002',
   changeOrigin:true,
   rewrite:path=>path.slice(4)
 },
 '^/api/v1/nfu-journal/(intent|operation|recover)$': {
   target:'http://127.0.0.1:3002',
   changeOrigin:true,
   rewrite:path=>path.slice(4)
 },
 '/lab-api':{target:'http://127.0.0.1:3002',changeOrigin:false,
  rewrite:path=>path.slice(8),bypass(req){if(!/^\/lab-api\/(auth\/(login|logout)|v1\/me|v1\/nfu\/(catalog|list|prepare|approve|sign|submit|query|recover|cancel))$/.test(req.url))return false;}}, '/api': {
  target:'http://127.0.0.1:3002',changeOrigin:true,
  rewrite:path=>path.slice(4),
  bypass(req){
    // Exact allowlist: Auth/context, local preparations and staged NFU routes; no arbitrary RPC, storage or admin.
    if(!['/api/auth/login','/api/auth/logout','/api/v1/me','/api/v1/wallet-proof/challenges','/api/v1/wallet-proof/verify','/api/v1/wallet-proof/status','/api/v1/nfu-real/context','/api/v1/nfu-real/company-batch-3-reference','/api/v1/nfu-real/company-batch-3-reconcile','/api/v1/nfu-journal/intent','/api/v1/nfu-journal/operation','/api/v1/nfu-journal/recover','/api/v1/nfu-preparations/create-batch','/api/v1/nfu-evidence/store','/api/v1/nfu-evidence/verify','/api/v1/nfu-evidence/head',...['catalog','review','prepare','evidence','inspect','simulate','approve','authorize-sign','signed','submit','query','recover','cancel'].map(step=>'/api/v1/nfu-live/'+step)].includes(req.url))return false;
  }
} };
export default defineConfig({
  root,
  cacheDir: 'node_modules/.vite',
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true, open: false, cors: false,
    allowedHosts: ['localhost', '127.0.0.1'],
    proxy: authProxy,
    watch: { ignored: ['**/.tools/**', '**/dist/**'] },
    fs: { strict: true, allow: [root], deny: ['**/.env', '**/.env.*', '**/.tools/**'] },
    headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, cors: false, proxy: authProxy },
  optimizeDeps: { entries: ['index.html','nfu-lab.html'], include: ['@stellar/freighter-api', '@stellar/stellar-sdk/base'] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false,
    rollupOptions:{input:{main:fileURLToPath(new URL('index.html',import.meta.url)),nfu:fileURLToPath(new URL('nfu-lab.html',import.meta.url)),tracking:fileURLToPath(new URL('nfu-tracking.html',import.meta.url)),reviewer:fileURLToPath(new URL('reviewer.html',import.meta.url))}} },
});
