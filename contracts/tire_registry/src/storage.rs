use soroban_sdk::{contracttype, Env};

use crate::{RegistryError, TireBatch};

#[contracttype]
#[derive(Clone)]
pub(crate) enum DataKey {
    LastId,
    Batch(u64),
}

// About 30 days at 5 seconds per ledger, capped to the network's actual limit.
const RETENTION_LEDGERS: u32 = 518_400;

fn retention(env: &Env) -> (u32, u32) {
    let target = RETENTION_LEDGERS.min(env.storage().max_ttl());
    (target / 2, target)
}

pub(crate) fn next_id(env: &Env) -> Result<u64, RegistryError> {
    let last: u64 = env.storage().instance().get(&DataKey::LastId).unwrap_or(0);
    let next = last.checked_add(1).ok_or(RegistryError::IdExhausted)?;
    env.storage().instance().set(&DataKey::LastId, &next);
    Ok(next)
}

pub(crate) fn load(env: &Env, id: u64) -> Result<TireBatch, RegistryError> {
    env.storage()
        .persistent()
        .get(&DataKey::Batch(id))
        .ok_or(RegistryError::BatchNotFound)
}

pub(crate) fn save(env: &Env, batch: &TireBatch) {
    env.storage()
        .persistent()
        .set(&DataKey::Batch(batch.id), batch);
    extend(env, batch.id);
}

pub(crate) fn extend(env: &Env, id: u64) {
    let (threshold, target) = retention(env);
    env.storage().instance().extend_ttl(threshold, target);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Batch(id), threshold, target);
}
