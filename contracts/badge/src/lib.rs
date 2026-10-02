#![no_std]

mod impact;
mod storage;
mod types;

pub use types::{BadgeError, BadgeLevel, BadgeRecord};

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

#[contract]
pub struct BadgeContract;

#[contractimpl]
impl BadgeContract {
    /// Only invoked once by Soroban at deployment. No subsequent source setter.
    pub fn __constructor(env: Env, impact_registry: Address) {
        env.storage()
            .instance()
            .set(&storage::DataKey::Source, &impact_registry);
        storage::touch_instance(&env);
    }

    /// Public deterministic trigger, returning only newly unlocked credentials.
    pub fn check_and_unlock(env: Env, company: Address) -> Result<Vec<BadgeRecord>, BadgeError> {
        let source = storage::source(&env)?;
        let snapshot = match impact::Client::new(&env, &source).try_get_company_impact(&company) {
            Ok(Ok(snapshot)) => snapshot,
            _ => return Err(BadgeError::SourceUnavailable),
        };
        if snapshot.company != company {
            return Err(BadgeError::InvalidCompany);
        }
        let mut records = storage::load(&env, &company);
        let mut unlocked = Vec::new(&env);
        for level in types::LEVELS {
            if snapshot.total_verified_grams >= level.threshold_grams()
                && !records.iter().any(|record| record.level == level)
            {
                let record = BadgeRecord {
                    company: company.clone(),
                    level,
                    unlocked_at: env.ledger().timestamp(),
                    unlocked_ledger: env.ledger().sequence(),
                    verified_grams: snapshot.total_verified_grams,
                    credited_batch_count: snapshot.credited_batch_count,
                    threshold_grams: level.threshold_grams(),
                    rules_version: 1,
                    impact_registry: source.clone(),
                };
                records.push_back(record.clone());
                unlocked.push_back(record);
            }
        }
        // One bounded write (at most five records), only after source validation.
        // Existing credentials retain their original evidence and unlock time.
        if !unlocked.is_empty() {
            storage::save(&env, &company, &records);
        }
        Ok(unlocked)
    }

    /// Returns recorded credentials in ascending level order, not pending eligibility.
    pub fn get_company_badges(env: Env, company: Address) -> Result<Vec<BadgeRecord>, BadgeError> {
        storage::source(&env)?;
        Ok(storage::load(&env, &company))
    }

    pub fn has_badge(
        env: Env,
        company: Address,
        badge_level: BadgeLevel,
    ) -> Result<bool, BadgeError> {
        Ok(Self::get_company_badges(env, company)?
            .iter()
            .any(|record| record.level == badge_level))
    }

    pub fn get_highest_badge(env: Env, company: Address) -> Result<Option<BadgeLevel>, BadgeError> {
        Ok(Self::get_company_badges(env, company)?
            .last()
            .map(|record| record.level))
    }

    pub fn get_badge_record(
        env: Env,
        company: Address,
        badge_level: BadgeLevel,
    ) -> Result<Option<BadgeRecord>, BadgeError> {
        Ok(Self::get_company_badges(env, company)?
            .iter()
            .find(|record| record.level == badge_level))
    }

    pub fn get_impact_registry(env: Env) -> Result<Address, BadgeError> {
        storage::source(&env)
    }
}

#[cfg(test)]
mod test;
