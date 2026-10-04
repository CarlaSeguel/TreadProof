import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { parse } from 'lossless-json';
import { ApiError, requireThat, batchId } from './validation.js';

const exec = promisify(execFile);
export const manifestUrl = new URL('../../deployments/testnet.json', import.meta.url);
export async function loadManifest() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  requireThat(manifest.network === 'testnet' && manifest.network_passphrase === 'Test SDF Network ; September 2015', 503, 'invalid_manifest');
  for (const name of ['tire_registry','impact_registry','badge_contract']) requireThat(/^C[A-Z2-7]{55}$/.test(manifest[name]),503,'invalid_manifest');
  requireThat(/^G[A-Z2-7]{55}$/.test(manifest.company),503,'invalid_manifest');
  return manifest;
}
export class StellarReader {
  constructor(manifest, { cli = process.env.STELLAR_CLI_PATH || 'stellar', run = exec } = {}) {
    this.manifest = manifest; this.cli = cli; this.run = run;
  }
  async call(contract, method, args = []) {
    const allowed = {
      tire_registry: ['get_batch'],
      impact_registry: ['get_tire_registry','get_company_impact','get_tirepoints','is_batch_credited'],
      badge_contract: ['get_impact_registry','get_company_badges','get_highest_badge'],
    };
    requireThat(allowed[contract]?.includes(method), 400, 'read_only_method');
    const command = ['--no-cache','contract','invoke','--id',this.manifest[contract],
      '--source-account',this.manifest.company,'--rpc-url','https://soroban-testnet.stellar.org/',
      '--network-passphrase',this.manifest.network_passphrase,'--send','no','--',method,...args];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STELLAR_')));
    try {
      const { stdout } = await this.run(this.cli, command, { timeout:30000, maxBuffer:1048576, windowsHide:true, env });
      // Return decimal strings for every integer, including u64/u128 beyond JS precision.
      return parse(stdout.trim(), null, { parseNumber: value => value });
    } catch (error) {
      if (method === 'get_batch' && /Error\(Contract, #1\)/.test(error.stderr || '')) throw new ApiError(404,'onchain_batch_not_found');
      throw new ApiError(503,'stellar_unavailable');
    }
  }
  async checkSources() {
    const [tire,impact] = await Promise.all([
      this.call('impact_registry','get_tire_registry'), this.call('badge_contract','get_impact_registry'),
    ]);
    requireThat(tire === this.manifest.tire_registry && impact === this.manifest.impact_registry,503,'canonical_source_mismatch');
  }
  async getBatch(id) {
    batchId(id);
    const batch = await this.call('tire_registry','get_batch',['--id',id]);
    requireThat(batch && String(batch.id) === id,503,'invalid_chain_response');
    return batch;
  }
  async getRecognition(company, id) {
    requireThat(/^[GC][A-Z2-7]{55}$/.test(company)); batchId(id);
    await this.checkSources();
    const [impact, tirepoints, credited, badges, highest] = await Promise.all([
      this.call('impact_registry','get_company_impact',['--company',company]),
      this.call('impact_registry','get_tirepoints',['--company',company]),
      this.call('impact_registry','is_batch_credited',['--batch_id',id]),
      this.call('badge_contract','get_company_badges',['--company',company]),
      this.call('badge_contract','get_highest_badge',['--company',company]),
    ]);
    requireThat(impact.company === company,503,'invalid_chain_response');
    return { impact,tirepoints,credited,badges,highest };
  }
}
