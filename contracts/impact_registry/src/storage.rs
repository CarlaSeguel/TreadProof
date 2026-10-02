use soroban_sdk::{contracttype, Address, Env};

use crate::{BatchCredit, CompanyImpact, ImpactError};

#[contracttype]
#[derive(Clone)]
pub(crate) enum DataKey {
    Source,
    Company(Address),
    Credit(u64),
}

fn retention(env: &Env) -> (u32, u32) {
    let target = 518_400.min(env.storage().max_ttl());
    (target / 2, target)
}

pub(crate) fn touch_instance(env: &Env) {
    let (threshold, target) = retention(env);
    env.storage().instance().extend_ttl(threshold, target);
}

fn touch_key(env: &Env, key: &DataKey) {
    let (threshold, target) = retention(env);
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, target);
}

pub(crate) fn source(env: &Env) -> Result<Address, ImpactError> {
    let address = env
        .storage()
        .instance()
        .get(&DataKey::Source)
        .ok_or(ImpactError::NotInitialized)?;
    touch_instance(env);
    Ok(address)
}

pub(crate) fn company(env: &Env, company: &Address) -> CompanyImpact {
    let key = DataKey::Company(company.clone());
    if let Some(impact) = env.storage().persistent().get(&key) {
        touch_key(env, &key);
        impact
    } else {
        CompanyImpact {
            company: company.clone(),
            total_verified_grams: 0,
            credited_batch_count: 0,
        }
    }
}

pub(crate) fn credit(env: &Env, id: u64) -> Option<BatchCredit> {
    let key = DataKey::Credit(id);
    let credit = env.storage().persistent().get(&key);
    if credit.is_some() {
        touch_key(env, &key);
    }
    credit
}

pub(crate) fn save(env: &Env, impact: &CompanyImpact, credit: &BatchCredit) {
    let company_key = DataKey::Company(impact.company.clone());
    let credit_key = DataKey::Credit(credit.batch_id);
    env.storage().persistent().set(&company_key, impact);
    env.storage().persistent().set(&credit_key, credit);
    touch_key(env, &company_key);
    touch_key(env, &credit_key);
    touch_instance(env);
}
