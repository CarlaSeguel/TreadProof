#![no_std]

mod storage;
mod tire;
mod types;

pub use types::{BatchCredit, CompanyImpact, ImpactError, TirePoints};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct ImpactRegistry;

#[contractimpl]
impl ImpactRegistry {
    /// Soroban invokes this once at deployment, atomically with contract creation.
    /// The deployer must select the genuine TireRegistry; there is no source setter.
    pub fn __constructor(env: Env, tire_registry: Address) {
        env.storage()
            .instance()
            .set(&storage::DataKey::Source, &tire_registry);
        storage::touch_instance(&env);
    }

    /// Permissionless trigger: neither beneficiary nor mass can be supplied.
    pub fn credit_batch(env: Env, batch_id: u64) -> Result<BatchCredit, ImpactError> {
        let source = storage::source(&env)?;
        if storage::credit(&env, batch_id).is_some() {
            return Err(ImpactError::AlreadyCredited);
        }
        let batch = match tire::Client::new(&env, &source).try_get_batch(&batch_id) {
            Ok(Ok(batch)) => batch,
            Err(Ok(tire::RegistryError::BatchNotFound)) => return Err(ImpactError::BatchNotFound),
            _ => return Err(ImpactError::SourceUnavailable),
        };
        if batch.id != batch_id {
            return Err(ImpactError::InvalidBatch);
        }
        if batch.status != tire::BatchStatus::Valorized {
            return Err(ImpactError::NotValorized);
        }
        let grams = batch.valorized_mass.ok_or(ImpactError::InvalidMass)?;
        let received = batch.received_mass.ok_or(ImpactError::InvalidMass)?;
        if grams == 0 || received == 0 || grams > received {
            return Err(ImpactError::InvalidMass);
        }
        let evidence = batch.evidence_hash.ok_or(ImpactError::InvalidEvidence)?;
        if evidence == BytesN::from_array(&env, &[0; 32]) {
            return Err(ImpactError::InvalidEvidence);
        }
        let mut impact = storage::company(&env, &batch.company);
        impact.total_verified_grams = impact
            .total_verified_grams
            .checked_add(u128::from(grams))
            .ok_or(ImpactError::NumericOverflow)?;
        impact.credited_batch_count = impact
            .credited_batch_count
            .checked_add(1)
            .ok_or(ImpactError::NumericOverflow)?;
        let credit = BatchCredit {
            batch_id,
            company: batch.company,
            verified_grams: grams,
            credited_at: env.ledger().timestamp(),
        };
        // All validation and checked arithmetic precede writes. Soroban rolls
        // back the whole invocation if either write or TTL extension fails.
        storage::save(&env, &impact, &credit);
        Ok(credit)
    }

    pub fn get_company_impact(env: Env, company: Address) -> Result<CompanyImpact, ImpactError> {
        storage::source(&env)?;
        Ok(storage::company(&env, &company))
    }

    pub fn is_batch_credited(env: Env, batch_id: u64) -> Result<bool, ImpactError> {
        storage::source(&env)?;
        Ok(storage::credit(&env, batch_id).is_some())
    }

    pub fn get_credited_batch_count(env: Env, company: Address) -> Result<u64, ImpactError> {
        Ok(Self::get_company_impact(env, company)?.credited_batch_count)
    }

    pub fn get_tirepoints(env: Env, company: Address) -> Result<TirePoints, ImpactError> {
        let grams = Self::get_company_impact(env, company)?.total_verified_grams;
        Ok(TirePoints {
            whole: grams / 1_000,
            remainder_grams: (grams % 1_000) as u32,
        })
    }

    pub fn get_batch_credit(env: Env, batch_id: u64) -> Result<Option<BatchCredit>, ImpactError> {
        storage::source(&env)?;
        Ok(storage::credit(&env, batch_id))
    }

    pub fn get_tire_registry(env: Env) -> Result<Address, ImpactError> {
        storage::source(&env)
    }
}

#[cfg(test)]
mod test;
