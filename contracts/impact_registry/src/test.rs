extern crate std;

use super::*;
use soroban_sdk::{
    contracttype,
    testutils::{Address as _, Ledger},
    IntoVal, String, Symbol,
};

struct Fixture {
    env: Env,
    tire: Address,
    impact: Address,
    company: Address,
    carrier: Address,
    plant: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
        let tire = env.register(tire::WASM, ());
        let impact = register_impact(&env, &tire);
        Self {
            company: Address::generate(&env),
            carrier: Address::generate(&env),
            plant: Address::generate(&env),
            env,
            tire,
            impact,
        }
    }

    fn client(&self) -> ImpactRegistryClient<'_> {
        ImpactRegistryClient::new(&self.env, &self.impact)
    }

    fn created(&self, company: &Address, mass: u64) -> u64 {
        tire::Client::new(&self.env, &self.tire)
            .mock_all_auths()
            .create_batch(company, &self.carrier, &self.plant, &mass)
    }

    fn received(&self, company: &Address, mass: u64) -> u64 {
        let id = self.created(company, mass);
        let client = tire::Client::new(&self.env, &self.tire).mock_all_auths();
        client.confirm_pickup(&id, &mass);
        client.start_transit(&id);
        client.confirm_reception(&id, &mass);
        id
    }

    fn valorized(&self, company: &Address, mass: u64) -> u64 {
        let id = self.received(company, mass);
        tire::Client::new(&self.env, &self.tire)
            .mock_all_auths()
            .confirm_valorization(&id, &mass, &BytesN::from_array(&self.env, &[7; 32]));
        id
    }

    // White-box corruption is test-only: production TireRegistry has no setter.
    fn change_batch(&self, id: u64, change: impl FnOnce(&mut tire::TireBatch)) {
        self.env.as_contract(&self.tire, || {
            let key = TireKey::Batch(id);
            let mut batch = self.env.storage().persistent().get(&key).unwrap();
            change(&mut batch);
            self.env.storage().persistent().set(&key, &batch);
        });
    }

    fn inject_impact(&self, grams: u128, count: u64) {
        self.env.as_contract(&self.impact, || {
            self.env.storage().persistent().set(
                &storage::DataKey::Company(self.company.clone()),
                &CompanyImpact {
                    company: self.company.clone(),
                    total_verified_grams: grams,
                    credited_batch_count: count,
                },
            );
        });
    }

    fn assert_uncredited(&self, id: u64) {
        assert!(!self.client().is_batch_credited(&id));
        assert_eq!(self.client().get_batch_credit(&id), None);
        assert_eq!(
            self.client()
                .get_company_impact(&self.company)
                .total_verified_grams,
            0
        );
        assert_eq!(self.client().get_credited_batch_count(&self.company), 0);
    }
}

fn register_impact(env: &Env, source: &Address) -> Address {
    #[cfg(not(feature = "wasm-tests"))]
    {
        env.register(ImpactRegistry, (source,))
    }
    #[cfg(feature = "wasm-tests")]
    {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/wasm32v1-none/release/impact_registry.wasm");
        let wasm = std::fs::read(path).expect("Build impact-registry Wasm first");
        env.register(wasm.as_slice(), (source,))
    }
}

#[contracttype]
#[derive(Clone)]
enum TireKey {
    Batch(u64),
}

#[test]
fn credit_valid_valorized_batch() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 4_900_000);
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 2_000);
    let credit = f.client().credit_batch(&id);
    assert_eq!(
        credit,
        BatchCredit {
            batch_id: id,
            company: f.company.clone(),
            verified_grams: 4_900_000,
            credited_at: 2_000
        }
    );
    assert_eq!(
        f.client().get_company_impact(&f.company),
        CompanyImpact {
            company: f.company.clone(),
            total_verified_grams: 4_900_000,
            credited_batch_count: 1
        }
    );
    assert_eq!(f.client().get_batch_credit(&id), Some(credit));
    assert!(f.client().is_batch_credited(&id));
}

#[test]
fn rejects_every_active_non_valorized_state() {
    let f = Fixture::new();
    let id = f.created(&f.company, 1_000);
    let tire = tire::Client::new(&f.env, &f.tire).mock_all_auths();
    for stage in 0..4 {
        assert_eq!(
            f.client().try_credit_batch(&id),
            Err(Ok(ImpactError::NotValorized))
        );
        f.assert_uncredited(id);
        match stage {
            0 => tire.confirm_pickup(&id, &1_000),
            1 => tire.start_transit(&id),
            2 => tire.confirm_reception(&id, &1_000),
            _ => (),
        }
    }
}

#[test]
fn rejects_cancelled_rejected_and_disputed_batches() {
    let f = Fixture::new();
    let cancelled = f.created(&f.company, 100);
    let rejected = f.received(&f.company, 100);
    let disputed = f.received(&f.company, 100);
    let tire = tire::Client::new(&f.env, &f.tire).mock_all_auths();
    let reason = String::from_str(&f.env, "Test exception");
    tire.cancel_batch(&cancelled, &reason);
    tire.reject_batch(&rejected, &reason);
    tire.dispute_batch(&disputed, &f.company, &reason);
    for id in [cancelled, rejected, disputed] {
        assert_eq!(
            f.client().try_credit_batch(&id),
            Err(Ok(ImpactError::NotValorized))
        );
        f.assert_uncredited(id);
    }
}

#[test]
fn beneficiary_comes_only_from_source_batch() {
    let f = Fixture::new();
    let other = Address::generate(&f.env);
    let id = f.valorized(&other, 7_500);
    let credit = f.client().credit_batch(&id);
    assert_eq!(credit.company, other);
    assert_eq!(
        f.client().get_company_impact(&other).total_verified_grams,
        7_500
    );
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        0
    );
    assert_eq!(
        f.client().get_company_impact(&f.plant).total_verified_grams,
        0
    );
    assert_eq!(
        f.client()
            .get_company_impact(&f.carrier)
            .total_verified_grams,
        0
    );
}

#[test]
fn duplicate_credit_preserves_totals_count_and_original_receipt() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 4_900_000);
    let receipt = f.client().credit_batch(&id);
    let before = f.client().get_company_impact(&f.company);
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 3_000);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::AlreadyCredited))
    );
    assert_eq!(f.client().get_company_impact(&f.company), before);
    assert_eq!(f.client().get_batch_credit(&id), Some(receipt));
}

#[test]
fn accumulates_multiple_batches() {
    let f = Fixture::new();
    for grams in [4_900_000, 2_000_000, 111] {
        let id = f.valorized(&f.company, grams);
        f.client().credit_batch(&id);
    }
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        6_900_111
    );
    assert_eq!(f.client().get_credited_batch_count(&f.company), 3);
}

#[test]
fn keeps_companies_separate() {
    let f = Fixture::new();
    let other = Address::generate(&f.env);
    for (company, grams) in [(&f.company, 2_000), (&other, 500), (&f.company, 3_000)] {
        let id = f.valorized(company, grams);
        f.client().credit_batch(&id);
    }
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        5_000
    );
    assert_eq!(f.client().get_credited_batch_count(&f.company), 2);
    assert_eq!(
        f.client().get_company_impact(&other).total_verified_grams,
        500
    );
    assert_eq!(f.client().get_credited_batch_count(&other), 1);
}

#[test]
fn converts_4900000_grams_to_4900_tirepoints() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 4_900_000);
    f.client().credit_batch(&id);
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: 4_900,
            remainder_grams: 0
        }
    );
}

#[test]
fn fractional_grams_accumulate_before_whole_point_conversion() {
    let f = Fixture::new();
    let first = f.valorized(&f.company, 600);
    f.client().credit_batch(&first);
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: 0,
            remainder_grams: 600
        }
    );
    let second = f.valorized(&f.company, 650);
    f.client().credit_batch(&second);
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: 1,
            remainder_grams: 250
        }
    );
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        1_250
    );
}

#[test]
fn one_gram_is_not_rounded_up_or_lost() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 1);
    f.client().credit_batch(&id);
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: 0,
            remainder_grams: 1
        }
    );
}

#[test]
fn missing_batch_returns_explicit_error_without_creating_impact() {
    let f = Fixture::new();
    for id in [0, 42, u64::MAX] {
        assert_eq!(
            f.client().try_credit_batch(&id),
            Err(Ok(ImpactError::BatchNotFound))
        );
        f.assert_uncredited(id);
    }
}

#[test]
fn rejects_zero_valorized_mass_at_trust_boundary() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    f.change_batch(id, |batch| batch.valorized_mass = Some(0));
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::InvalidMass))
    );
    f.assert_uncredited(id);
}

#[test]
fn rejects_missing_valorized_mass_at_trust_boundary() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    f.change_batch(id, |batch| batch.valorized_mass = None);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::InvalidMass))
    );
    f.assert_uncredited(id);
}

#[test]
fn rejects_invalid_received_mass_and_excess_valorization() {
    let f = Fixture::new();
    for received in [None, Some(0), Some(99)] {
        let id = f.valorized(&f.company, 100);
        f.change_batch(id, |batch| batch.received_mass = received);
        assert_eq!(
            f.client().try_credit_batch(&id),
            Err(Ok(ImpactError::InvalidMass))
        );
        f.assert_uncredited(id);
    }
}

#[test]
fn rejects_missing_or_empty_evidence() {
    let f = Fixture::new();
    for evidence in [None, Some(BytesN::from_array(&f.env, &[0; 32]))] {
        let id = f.valorized(&f.company, 100);
        f.change_batch(id, |batch| batch.evidence_hash = evidence);
        assert_eq!(
            f.client().try_credit_batch(&id),
            Err(Ok(ImpactError::InvalidEvidence))
        );
        f.assert_uncredited(id);
    }
}

#[test]
fn rejects_mismatched_batch_id() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    f.change_batch(id, |batch| batch.id = id + 1);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::InvalidBatch))
    );
    f.assert_uncredited(id);
}

#[test]
fn permissionless_trigger_needs_no_signature_and_cannot_redirect() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    f.env.mock_auths(&[]);
    let credit = f.client().credit_batch(&id);
    assert!(f.env.auths().is_empty());
    assert_eq!(credit.company, f.company);
    assert_eq!(credit.verified_grams, 100);
}

#[test]
fn unknown_company_has_zero_impact_points_and_count() {
    let f = Fixture::new();
    assert_eq!(
        f.client().get_company_impact(&f.company),
        CompanyImpact {
            company: f.company.clone(),
            total_verified_grams: 0,
            credited_batch_count: 0
        }
    );
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: 0,
            remainder_grams: 0
        }
    );
    f.assert_uncredited(1);
}

#[test]
fn multiple_max_u64_batches_accumulate_without_u64_truncation() {
    let f = Fixture::new();
    for _ in 0..2 {
        let id = f.valorized(&f.company, u64::MAX);
        f.client().credit_batch(&id);
    }
    let total = 2 * u128::from(u64::MAX);
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        total
    );
    assert_eq!(
        f.client().get_tirepoints(&f.company),
        TirePoints {
            whole: total / 1_000,
            remainder_grams: (total % 1_000) as u32
        }
    );
}

#[test]
fn total_overflow_rolls_back_receipt_and_count() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 1);
    f.inject_impact(u128::MAX, 4);
    let before = f.client().get_company_impact(&f.company);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::NumericOverflow))
    );
    assert_eq!(f.client().get_company_impact(&f.company), before);
    assert!(!f.client().is_batch_credited(&id));
}

#[test]
fn count_overflow_does_not_partially_increase_grams() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 1);
    f.inject_impact(1, u64::MAX);
    let before = f.client().get_company_impact(&f.company);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::NumericOverflow))
    );
    assert_eq!(f.client().get_company_impact(&f.company), before);
    assert_eq!(f.client().get_batch_credit(&id), None);
}

#[test]
fn total_can_reach_exact_u128_maximum_without_wrapping() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 1);
    f.inject_impact(u128::MAX - 1, 1);
    f.client().credit_batch(&id);
    assert_eq!(
        f.client()
            .get_company_impact(&f.company)
            .total_verified_grams,
        u128::MAX
    );
    assert_eq!(f.client().get_credited_batch_count(&f.company), 2);
}

#[test]
fn configured_source_is_fixed_and_constructor_cannot_be_replayed() {
    let f = Fixture::new();
    let other = Address::generate(&f.env);
    assert_eq!(f.client().get_tire_registry(), f.tire);
    let result = f.env.try_invoke_contract::<(), ImpactError>(
        &f.impact,
        &Symbol::new(&f.env, "__constructor"),
        (other,).into_val(&f.env),
    );
    assert!(result.is_err());
    assert_eq!(f.client().get_tire_registry(), f.tire);
}

#[test]
fn unavailable_source_fails_closed() {
    let f = Fixture::new();
    let unavailable = Address::generate(&f.env);
    let address = register_impact(&f.env, &unavailable);
    let client = ImpactRegistryClient::new(&f.env, &address);
    assert_eq!(
        client.try_credit_batch(&1),
        Err(Ok(ImpactError::SourceUnavailable))
    );
    assert!(!client.is_batch_credited(&1));
    assert_eq!(client.get_credited_batch_count(&f.company), 0);
}

#[test]
fn same_id_in_another_registry_cannot_supply_impact() {
    let f = Fixture::new();
    let original = f.created(&f.company, 100);
    // A second genuine registry has a VALORIZED batch with the same numeric ID.
    let other = f.env.register(tire::WASM, ());
    let client = tire::Client::new(&f.env, &other).mock_all_auths();
    let id = client.create_batch(&f.company, &f.carrier, &f.plant, &900);
    assert_eq!(id, original);
    client.confirm_pickup(&id, &900);
    client.start_transit(&id);
    client.confirm_reception(&id, &900);
    client.confirm_valorization(&id, &900, &BytesN::from_array(&f.env, &[1; 32]));
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::NotValorized))
    );
    f.assert_uncredited(id);
}

#[test]
fn credits_only_valorized_mass_not_declared_or_received() {
    let f = Fixture::new();
    let id = f.received(&f.company, 5_000_000);
    tire::Client::new(&f.env, &f.tire)
        .mock_all_auths()
        .confirm_valorization(&id, &4_900_000, &BytesN::from_array(&f.env, &[1; 32]));
    assert_eq!(f.client().credit_batch(&id).verified_grams, 4_900_000);
}

#[test]
fn failed_early_credit_can_be_retried_after_valorization() {
    let f = Fixture::new();
    let id = f.received(&f.company, 100);
    assert_eq!(
        f.client().try_credit_batch(&id),
        Err(Ok(ImpactError::NotValorized))
    );
    tire::Client::new(&f.env, &f.tire)
        .mock_all_auths()
        .confirm_valorization(&id, &100, &BytesN::from_array(&f.env, &[1; 32]));
    f.client().credit_batch(&id);
    assert_eq!(f.client().get_credited_batch_count(&f.company), 1);
}

#[test]
fn credit_does_not_modify_tire_batch() {
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    let client = tire::Client::new(&f.env, &f.tire);
    let before = client.get_batch(&id);
    f.client().credit_batch(&id);
    assert_eq!(client.get_batch(&id), before);
}

#[test]
fn persistent_totals_and_receipts_have_extended_lifetimes() {
    use soroban_sdk::testutils::storage::{Instance, Persistent};
    let f = Fixture::new();
    let id = f.valorized(&f.company, 100);
    f.client().credit_batch(&id);
    f.env.as_contract(&f.impact, || {
        assert!(f.env.storage().instance().get_ttl() >= 100_000);
        assert!(
            f.env
                .storage()
                .persistent()
                .get_ttl(&storage::DataKey::Company(f.company.clone()))
                >= 100_000
        );
        assert!(
            f.env
                .storage()
                .persistent()
                .get_ttl(&storage::DataKey::Credit(id))
                >= 100_000
        );
    });
}
