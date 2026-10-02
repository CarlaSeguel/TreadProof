use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::{BadgeError, BadgeRecord};

#[contracttype]
#[derive(Clone)]
pub(crate) enum DataKey {
    Source,
    Badges(Address),
}

fn retention(env: &Env) -> (u32, u32) {
    let target = 518_400.min(env.storage().max_ttl());
    (target / 2, target)
}

pub(crate) fn touch_instance(env: &Env) {
    let (threshold, target) = retention(env);
    env.storage().instance().extend_ttl(threshold, target);
}

pub(crate) fn source(env: &Env) -> Result<Address, BadgeError> {
    let source = env
        .storage()
        .instance()
        .get(&DataKey::Source)
        .ok_or(BadgeError::NotInitialized)?;
    touch_instance(env);
    Ok(source)
}

fn touch_badges(env: &Env, key: &DataKey) {
    let (threshold, target) = retention(env);
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, target);
}

pub(crate) fn load(env: &Env, company: &Address) -> Vec<BadgeRecord> {
    let key = DataKey::Badges(company.clone());
    if let Some(records) = env.storage().persistent().get(&key) {
        touch_badges(env, &key);
        records
    } else {
        Vec::new(env)
    }
}

pub(crate) fn save(env: &Env, company: &Address, records: &Vec<BadgeRecord>) {
    let key = DataKey::Badges(company.clone());
    env.storage().persistent().set(&key, records);
    touch_badges(env, &key);
    touch_instance(env);
}
