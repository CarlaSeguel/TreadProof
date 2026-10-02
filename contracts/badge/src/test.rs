extern crate std;

use super::*;
use soroban_sdk::{
    contracttype,
    testutils::{Address as _, Ledger},
    BytesN, IntoVal, Symbol,
};

mod tire {
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/tire_registry.wasm");
}

struct Fixture {
    env: Env,
    tire: Address,
    impact: Address,
    badge: Address,
    company: Address,
    carrier: Address,
    plant: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().with_mut(|ledger| {
            ledger.timestamp = 1_000;
            ledger.sequence_number = 100;
        });
        let tire = env.register(tire::WASM, ());
        let impact = env.register(impact::WASM, (&tire,));
        let badge = register_badge(&env, &impact);
        Self {
            company: Address::generate(&env),
            carrier: Address::generate(&env),
            plant: Address::generate(&env),
            env,
            tire,
            impact,
            badge,
        }
    }

    fn client(&self) -> BadgeContractClient<'_> {
        BadgeContractClient::new(&self.env, &self.badge)
    }

    fn valorize(&self, company: &Address, grams: u64) -> u64 {
        let client = tire::Client::new(&self.env, &self.tire).mock_all_auths();
        let id = client.create_batch(company, &self.carrier, &self.plant, &grams);
        client.confirm_pickup(&id, &grams);
        client.start_transit(&id);
        client.confirm_reception(&id, &grams);
        client.confirm_valorization(&id, &grams, &BytesN::from_array(&self.env, &[7; 32]));
        id
    }

    fn credit(&self, company: &Address, grams: u64) -> u64 {
        let id = self.valorize(company, grams);
        impact::Client::new(&self.env, &self.impact).credit_batch(&id);
        id
    }

    // Test-only fault injection: the deployed ImpactRegistry exposes no such setter.
    fn inject_snapshot(&self, snapshot: &impact::CompanyImpact) {
        self.env.as_contract(&self.impact, || {
            self.env
                .storage()
                .persistent()
                .set(&ImpactKey::Company(self.company.clone()), snapshot);
        });
    }
}

fn register_badge(env: &Env, source: &Address) -> Address {
    #[cfg(not(feature = "wasm-tests"))]
    {
        env.register(BadgeContract, (source,))
    }
    #[cfg(feature = "wasm-tests")]
    {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/wasm32v1-none/release/badge_contract.wasm");
        let wasm = std::fs::read(path).expect("Build BadgeContract Wasm first");
        env.register(wasm.as_slice(), (source,))
    }
}

#[contracttype]
#[derive(Clone)]
enum ImpactKey {
    Company(Address),
    Source,
}

// Independent expected values: do not derive test expectations from implementation.
const EXPECTED: [(BadgeLevel, u64); 5] = [
    (BadgeLevel::Trace, 1_000_000),
    (BadgeLevel::Recover, 10_000_000),
    (BadgeLevel::Circular, 25_000_000),
    (BadgeLevel::Impact, 50_000_000),
    (BadgeLevel::Champion, 100_000_000),
];

fn assert_unlock(grams: u64, highest: BadgeLevel, count: u32) {
    let f = Fixture::new();
    f.credit(&f.company, grams);
    let records = f.client().check_and_unlock(&f.company);
    assert_eq!(records.len(), count);
    assert_eq!(records.last().unwrap().level, highest);
    assert_eq!(f.client().get_highest_badge(&f.company), Some(highest));
    for (index, (level, threshold)) in EXPECTED.iter().take(count as usize).enumerate() {
        let record = records.get(index as u32).unwrap();
        assert_eq!(record.company, f.company);
        assert_eq!(record.level, *level);
        assert_eq!(record.threshold_grams, u128::from(*threshold));
        assert_eq!(record.verified_grams, u128::from(grams));
        assert!(f.client().has_badge(&f.company, level));
    }
}

#[test]
fn zero_impact_does_not_unlock_badges() {
    let f = Fixture::new();
    assert!(f.client().check_and_unlock(&f.company).is_empty());
    assert!(f.client().get_company_badges(&f.company).is_empty());
}

#[test]
fn unlocks_trace_at_exact_threshold() {
    assert_unlock(1_000_000, BadgeLevel::Trace, 1);
}
#[test]
fn unlocks_recover_at_exact_threshold() {
    assert_unlock(10_000_000, BadgeLevel::Recover, 2);
}
#[test]
fn unlocks_circular_at_exact_threshold() {
    assert_unlock(25_000_000, BadgeLevel::Circular, 3);
}
#[test]
fn unlocks_impact_at_exact_threshold() {
    assert_unlock(50_000_000, BadgeLevel::Impact, 4);
}
#[test]
fn unlocks_champion_at_exact_threshold() {
    assert_unlock(100_000_000, BadgeLevel::Champion, 5);
}

#[test]
fn one_gram_below_each_threshold_does_not_unlock_that_level() {
    let f = Fixture::new();
    for (index, (level, grams)) in EXPECTED.iter().enumerate() {
        let company = Address::generate(&f.env);
        f.credit(&company, grams - 1);
        assert_eq!(f.client().check_and_unlock(&company).len(), index as u32);
        assert!(!f.client().has_badge(&company, level));
    }
}

#[test]
fn one_gram_above_each_threshold_unlocks_that_level() {
    let f = Fixture::new();
    for (index, (level, grams)) in EXPECTED.iter().enumerate() {
        let company = Address::generate(&f.env);
        f.credit(&company, grams + 1);
        assert_eq!(
            f.client().check_and_unlock(&company).len(),
            index as u32 + 1
        );
        assert_eq!(f.client().get_highest_badge(&company), Some(*level));
    }
}

#[test]
fn champion_unlocks_all_lower_badges_in_ascending_order() {
    let f = Fixture::new();
    f.credit(&f.company, 150_000_000);
    let records = f.client().check_and_unlock(&f.company);
    assert_eq!(records.len(), 5);
    for (index, (level, _)) in EXPECTED.iter().enumerate() {
        assert_eq!(records.get(index as u32).unwrap().level, *level);
    }
}

#[test]
fn repeated_checks_return_empty_and_never_replace_records() {
    let f = Fixture::new();
    f.credit(&f.company, 100_000_000);
    let records = f.client().check_and_unlock(&f.company);
    f.env.ledger().with_mut(|ledger| {
        ledger.timestamp = 5_000;
        ledger.sequence_number = 101;
    });
    for _ in 0..3 {
        assert!(f.client().check_and_unlock(&f.company).is_empty());
    }
    assert_eq!(f.client().get_company_badges(&f.company), records);
}

#[test]
fn progressive_unlocks_preserve_original_snapshot_and_timestamp() {
    let f = Fixture::new();
    f.credit(&f.company, 1_000_000);
    let trace = f.client().check_and_unlock(&f.company).get(0).unwrap();
    f.env.ledger().with_mut(|ledger| {
        ledger.timestamp = 2_000;
        ledger.sequence_number = 102;
    });
    f.credit(&f.company, 24_000_000);
    let unlocked = f.client().check_and_unlock(&f.company);
    assert_eq!(unlocked.len(), 2);
    assert_eq!(unlocked.get(0).unwrap().level, BadgeLevel::Recover);
    assert_eq!(unlocked.get(1).unwrap().level, BadgeLevel::Circular);
    assert_eq!(unlocked.get(1).unwrap().verified_grams, 25_000_000);
    assert_eq!(unlocked.get(1).unwrap().credited_batch_count, 2);
    assert_eq!(unlocked.get(1).unwrap().unlocked_at, 2_000);
    assert_eq!(unlocked.get(1).unwrap().unlocked_ledger, 102);
    assert_eq!(
        f.client().get_badge_record(&f.company, &BadgeLevel::Trace),
        Some(trace)
    );
}

#[test]
fn companies_have_independent_credentials() {
    let f = Fixture::new();
    let other = Address::generate(&f.env);
    f.credit(&f.company, 100_000_000);
    f.credit(&other, 1_000_000);
    f.client().check_and_unlock(&f.company);
    f.client().check_and_unlock(&other);
    assert_eq!(f.client().get_company_badges(&f.company).len(), 5);
    assert_eq!(f.client().get_company_badges(&other).len(), 1);
    assert_eq!(
        f.client().get_highest_badge(&other),
        Some(BadgeLevel::Trace)
    );
    assert_eq!(
        f.client()
            .get_company_badges(&other)
            .get(0)
            .unwrap()
            .company,
        other
    );
}

#[test]
fn highest_badge_tracks_recorded_progression() {
    let f = Fixture::new();
    let mut previous = 0;
    for (level, grams) in EXPECTED {
        f.credit(&f.company, grams - previous);
        f.client().check_and_unlock(&f.company);
        assert_eq!(f.client().get_highest_badge(&f.company), Some(level));
        previous = grams;
    }
}

#[test]
fn empty_queries_return_none_false_and_empty_list() {
    let f = Fixture::new();
    assert_eq!(f.client().get_highest_badge(&f.company), None);
    assert!(f.client().get_company_badges(&f.company).is_empty());
    for (level, _) in EXPECTED {
        assert!(!f.client().has_badge(&f.company, &level));
        assert_eq!(f.client().get_badge_record(&f.company, &level), None);
    }
}

#[test]
fn eligibility_is_not_issued_until_check_is_executed() {
    let f = Fixture::new();
    f.credit(&f.company, 100_000_000);
    assert_eq!(f.client().get_highest_badge(&f.company), None);
    assert!(!f.client().has_badge(&f.company, &BadgeLevel::Champion));
    assert_eq!(f.client().check_and_unlock(&f.company).len(), 5);
}

#[test]
fn valorized_but_uncredited_batch_cannot_unlock_a_badge() {
    let f = Fixture::new();
    let id = f.valorize(&f.company, 100_000_000);
    assert!(f.client().check_and_unlock(&f.company).is_empty());
    impact::Client::new(&f.env, &f.impact).credit_batch(&id);
    assert_eq!(f.client().check_and_unlock(&f.company).len(), 5);
}

#[test]
fn trigger_requires_no_signature_and_cannot_redirect_credentials() {
    let f = Fixture::new();
    f.credit(&f.company, 1_000_000);
    f.env.mock_auths(&[]);
    let record = f.client().check_and_unlock(&f.company).get(0).unwrap();
    assert!(f.env.auths().is_empty());
    assert_eq!(record.company, f.company);
    assert!(f.client().check_and_unlock(&f.carrier).is_empty());
    assert!(f.client().check_and_unlock(&f.plant).is_empty());
}

#[test]
fn stores_unlock_evidence_and_rule_version() {
    let f = Fixture::new();
    f.credit(&f.company, 1_234_567);
    let record = f.client().check_and_unlock(&f.company).get(0).unwrap();
    assert_eq!(
        record,
        BadgeRecord {
            company: f.company.clone(),
            level: BadgeLevel::Trace,
            unlocked_at: 1_000,
            unlocked_ledger: 100,
            verified_grams: 1_234_567,
            credited_batch_count: 1,
            threshold_grams: 1_000_000,
            rules_version: 1,
            impact_registry: f.impact.clone(),
        }
    );
}

#[test]
fn inaccessible_source_fails_without_issuing_credentials() {
    let f = Fixture::new();
    let address = register_badge(&f.env, &Address::generate(&f.env));
    let client = BadgeContractClient::new(&f.env, &address);
    assert_eq!(
        client.try_check_and_unlock(&f.company),
        Err(Ok(BadgeError::SourceUnavailable))
    );
    assert!(client.get_company_badges(&f.company).is_empty());
}

#[test]
fn incorrect_contract_interface_fails_closed() {
    let f = Fixture::new();
    let address = register_badge(&f.env, &f.tire);
    let client = BadgeContractClient::new(&f.env, &address);
    assert_eq!(
        client.try_check_and_unlock(&f.company),
        Err(Ok(BadgeError::SourceUnavailable))
    );
    assert_eq!(client.get_highest_badge(&f.company), None);
}

#[test]
fn response_for_another_company_is_rejected() {
    let f = Fixture::new();
    f.inject_snapshot(&impact::CompanyImpact {
        company: f.plant.clone(),
        total_verified_grams: 100_000_000,
        credited_batch_count: 1,
    });
    assert_eq!(
        f.client().try_check_and_unlock(&f.company),
        Err(Ok(BadgeError::InvalidCompany))
    );
    assert!(f.client().get_company_badges(&f.company).is_empty());
    assert!(f.client().get_company_badges(&f.plant).is_empty());
}

#[test]
fn source_is_fixed_and_constructor_cannot_be_replayed() {
    let f = Fixture::new();
    assert_eq!(f.client().get_impact_registry(), f.impact);
    let result = f.env.try_invoke_contract::<(), BadgeError>(
        &f.badge,
        &Symbol::new(&f.env, "__constructor"),
        (&f.tire,).into_val(&f.env),
    );
    assert!(result.is_err());
    assert_eq!(f.client().get_impact_registry(), f.impact);
}

#[test]
fn noncanonical_impact_registry_cannot_supply_the_balance() {
    let f = Fixture::new();
    let other = f.env.register(impact::WASM, (&f.tire,));
    let id = f.valorize(&f.company, 100_000_000);
    impact::Client::new(&f.env, &other).credit_batch(&id);
    assert!(f.client().check_and_unlock(&f.company).is_empty());
    assert_eq!(f.client().get_impact_registry(), f.impact);
}

#[test]
fn unlocking_preserves_both_source_contracts_data() {
    let f = Fixture::new();
    let id = f.credit(&f.company, 100_000_000);
    let tire = tire::Client::new(&f.env, &f.tire);
    let impact = impact::Client::new(&f.env, &f.impact);
    let batch_before = tire.get_batch(&id);
    let impact_before = impact.get_company_impact(&f.company);
    let credit_before = impact.get_batch_credit(&id);
    f.client().check_and_unlock(&f.company);
    assert_eq!(tire.get_batch(&id), batch_before);
    assert_eq!(impact.get_company_impact(&f.company), impact_before);
    assert_eq!(impact.get_batch_credit(&id), credit_before);
}

#[test]
fn fractional_grams_accumulate_without_rounding_up_threshold() {
    let f = Fixture::new();
    f.credit(&f.company, 999_999);
    assert!(f.client().check_and_unlock(&f.company).is_empty());
    f.credit(&f.company, 1);
    assert_eq!(
        f.client()
            .check_and_unlock(&f.company)
            .get(0)
            .unwrap()
            .verified_grams,
        1_000_000
    );
}

#[test]
fn maximum_u128_snapshot_is_compared_without_truncation() {
    let f = Fixture::new();
    f.inject_snapshot(&impact::CompanyImpact {
        company: f.company.clone(),
        total_verified_grams: u128::MAX,
        credited_batch_count: u64::MAX,
    });
    let records = f.client().check_and_unlock(&f.company);
    assert_eq!(records.len(), 5);
    assert_eq!(records.last().unwrap().verified_grams, u128::MAX);
}

#[test]
fn source_error_preserves_existing_credentials_and_queries_still_work() {
    let f = Fixture::new();
    f.credit(&f.company, 1_000_000);
    let records = f.client().check_and_unlock(&f.company);
    f.env.as_contract(&f.impact, || {
        f.env.storage().instance().remove(&ImpactKey::Source);
    });
    assert_eq!(
        f.client().try_check_and_unlock(&f.company),
        Err(Ok(BadgeError::SourceUnavailable))
    );
    assert_eq!(f.client().get_company_badges(&f.company), records);
    assert_eq!(
        f.client().get_highest_badge(&f.company),
        Some(BadgeLevel::Trace)
    );
}

#[test]
fn credentials_cannot_be_transferred() {
    let f = Fixture::new();
    f.credit(&f.company, 1_000_000);
    let records = f.client().check_and_unlock(&f.company);
    let result = f.env.try_invoke_contract::<(), BadgeError>(
        &f.badge,
        &Symbol::new(&f.env, "transfer"),
        (&f.company, &f.plant, BadgeLevel::Trace).into_val(&f.env),
    );
    assert!(result.is_err());
    assert_eq!(f.client().get_company_badges(&f.company), records);
    assert!(f.client().get_company_badges(&f.plant).is_empty());
}

#[test]
fn persistent_credentials_and_configuration_extend_ttl() {
    use soroban_sdk::testutils::storage::{Instance, Persistent};
    let f = Fixture::new();
    f.credit(&f.company, 1_000_000);
    f.client().check_and_unlock(&f.company);
    f.env.as_contract(&f.badge, || {
        assert!(f.env.storage().instance().get_ttl() >= 100_000);
        assert!(
            f.env
                .storage()
                .persistent()
                .get_ttl(&storage::DataKey::Badges(f.company.clone()))
                >= 100_000
        );
    });
}
