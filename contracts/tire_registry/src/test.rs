use super::*;
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, MockAuth, MockAuthInvoke,
    },
    IntoVal, Symbol, Val,
};

struct Fixture {
    env: Env,
    contract: Address,
    company: Address,
    carrier: Address,
    plant: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        // Successful-path tests also assert the recorded authorization tree.
        // Negative authorization tests replace this with an explicit signer set.
        env.mock_all_auths();
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
        #[cfg(not(feature = "wasm-tests"))]
        let contract = env.register(TireRegistry, ());
        #[cfg(feature = "wasm-tests")]
        let contract = {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/wasm32v1-none/release/tire_registry.wasm");
            let wasm = std::fs::read(path).expect("Build the Wasm with Stellar CLI first");
            env.register(wasm.as_slice(), ())
        };
        Self {
            contract,
            company: Address::generate(&env),
            carrier: Address::generate(&env),
            plant: Address::generate(&env),
            env,
        }
    }

    fn client(&self) -> TireRegistryClient<'_> {
        TireRegistryClient::new(&self.env, &self.contract)
    }

    fn created(&self) -> u64 {
        self.client().mock_all_auths().create_batch(
            &self.company,
            &self.carrier,
            &self.plant,
            &5_100_000,
        )
    }

    fn picked_up(&self) -> u64 {
        let id = self.created();
        self.client()
            .mock_all_auths()
            .confirm_pickup(&id, &5_000_000);
        id
    }

    fn in_transit(&self) -> u64 {
        let id = self.picked_up();
        self.client().mock_all_auths().start_transit(&id);
        id
    }

    fn received(&self) -> u64 {
        let id = self.in_transit();
        self.client()
            .mock_all_auths()
            .confirm_reception(&id, &4_950_000);
        id
    }

    fn hash(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7; 32])
    }

    fn reason(&self) -> String {
        String::from_str(&self.env, "Documented discrepancy")
    }

    fn assert_auth(&self, address: &Address, name: &str, args: Vec<Val>) {
        assert_eq!(
            self.env.auths(),
            std::vec![(
                address.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.contract.clone(),
                        Symbol::new(&self.env, name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                }
            )]
        );
    }

    fn authorize_only(&self, address: &Address, name: &str, args: Vec<Val>) {
        self.env.mock_auths(&[MockAuth {
            address,
            invoke: &MockAuthInvoke {
                contract: &self.contract,
                fn_name: name,
                args,
                sub_invokes: &[],
            },
        }]);
    }
}

extern crate std;

#[test]
fn creation_valid() {
    let f = Fixture::new();
    let id = f.created();
    f.assert_auth(
        &f.company,
        "create_batch",
        (&f.company, &f.carrier, &f.plant, 5_100_000u64).into_val(&f.env),
    );
    let batch = f.client().get_batch(&id);
    assert_eq!(id, 1);
    assert_eq!(batch.company, f.company);
    assert_eq!(batch.carrier, f.carrier);
    assert_eq!(batch.plant, f.plant);
    assert_eq!(batch.declared_mass, 5_100_000);
    assert_eq!(batch.status, BatchStatus::Created);
    assert_eq!(batch.pickup_mass, None);
    assert_eq!(batch.received_mass, None);
    assert_eq!(batch.valorized_mass, None);
    assert_eq!(batch.evidence_hash, None);
    assert_eq!(batch.created_at, 1_000);
    assert_eq!(batch.updated_at, 1_000);
    assert_eq!(batch.history.len(), 1);
}

#[test]
fn creation_zero_mass_does_not_consume_id() {
    let f = Fixture::new();
    assert_eq!(
        f.client()
            .mock_all_auths()
            .try_create_batch(&f.company, &f.carrier, &f.plant, &0,),
        Err(Ok(RegistryError::InvalidMass))
    );
    assert_eq!(f.created(), 1);
}

#[test]
fn creation_requires_company_authorization() {
    let f = Fixture::new();
    f.authorize_only(
        &f.carrier,
        "create_batch",
        (&f.company, &f.carrier, &f.plant, 5_100_000u64).into_val(&f.env),
    );
    assert!(f
        .client()
        .try_create_batch(&f.company, &f.carrier, &f.plant, &5_100_000)
        .is_err());
    assert_eq!(f.created(), 1);
}

#[test]
fn ids_are_unique_and_batches_independent() {
    let f = Fixture::new();
    let first = f.created();
    let second = f.created();
    assert_eq!(second, first + 1);
    f.client().confirm_pickup(&first, &100);
    assert_eq!(f.client().get_batch(&second).status, BatchStatus::Created);
}

#[test]
fn pickup_valid_preserves_declared_mass() {
    let f = Fixture::new();
    let id = f.created();
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 1_100);
    f.client().confirm_pickup(&id, &5_000_000);
    f.assert_auth(
        &f.carrier,
        "confirm_pickup",
        (id, 5_000_000u64).into_val(&f.env),
    );
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::PickedUp);
    assert_eq!(batch.pickup_mass, Some(5_000_000));
    assert_eq!(batch.declared_mass, 5_100_000);
    assert_eq!(batch.created_at, 1_000);
    assert_eq!(batch.updated_at, 1_100);
}

#[test]
fn pickup_wrong_state_preserves_measurement() {
    let f = Fixture::new();
    let id = f.picked_up();
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client().try_confirm_pickup(&id, &9),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn pickup_zero_mass_rejected() {
    let f = Fixture::new();
    let id = f.created();
    assert_eq!(
        f.client().try_confirm_pickup(&id, &0),
        Err(Ok(RegistryError::InvalidMass))
    );
    assert_eq!(f.client().get_batch(&id).pickup_mass, None);
}

#[test]
fn pickup_wrong_actor_rejected() {
    let f = Fixture::new();
    let id = f.created();
    let before = f.client().get_batch(&id);
    f.authorize_only(
        &f.company,
        "confirm_pickup",
        (id, 5_000_000u64).into_val(&f.env),
    );
    assert!(f.client().try_confirm_pickup(&id, &5_000_000).is_err());
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn transit_valid_preserves_masses() {
    let f = Fixture::new();
    let id = f.in_transit();
    f.assert_auth(&f.carrier, "start_transit", (id,).into_val(&f.env));
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::InTransit);
    assert_eq!(batch.declared_mass, 5_100_000);
    assert_eq!(batch.pickup_mass, Some(5_000_000));
    assert_eq!(batch.received_mass, None);
}

#[test]
fn transit_requires_carrier_authorization() {
    let f = Fixture::new();
    let id = f.picked_up();
    f.authorize_only(&f.plant, "start_transit", (id,).into_val(&f.env));
    assert!(f.client().try_start_transit(&id).is_err());
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::PickedUp);
}

#[test]
fn reception_valid_with_lower_mass() {
    let f = Fixture::new();
    let id = f.received();
    f.assert_auth(
        &f.plant,
        "confirm_reception",
        (id, 4_950_000u64).into_val(&f.env),
    );
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::Received);
    assert_eq!(batch.received_mass, Some(4_950_000));
    assert_eq!(batch.pickup_mass, Some(5_000_000));
}

#[test]
fn reception_higher_than_pickup_does_not_dispute() {
    let f = Fixture::new();
    let id = f.in_transit();
    f.client().confirm_reception(&id, &5_050_000);
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::Received);
    assert_eq!(batch.pickup_mass, Some(5_000_000));
    assert_eq!(batch.received_mass, Some(5_050_000));
}

#[test]
fn reception_wrong_actor_rejected_without_changes() {
    let f = Fixture::new();
    let id = f.in_transit();
    let before = f.client().get_batch(&id);
    f.authorize_only(
        &f.carrier,
        "confirm_reception",
        (id, 4_950_000u64).into_val(&f.env),
    );
    assert!(f.client().try_confirm_reception(&id, &4_950_000).is_err());
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn reception_zero_mass_rejected() {
    let f = Fixture::new();
    let id = f.in_transit();
    assert_eq!(
        f.client().try_confirm_reception(&id, &0),
        Err(Ok(RegistryError::InvalidMass))
    );
    assert_eq!(f.client().get_batch(&id).received_mass, None);
}

#[test]
fn reception_cannot_overwrite_previous_measurement() {
    let f = Fixture::new();
    let id = f.received();
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client().try_confirm_reception(&id, &123),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn valorization_valid_preserves_actors_masses_and_history() {
    let f = Fixture::new();
    let id = f.received();
    f.env.ledger().with_mut(|ledger| ledger.timestamp = 2_000);
    f.client().confirm_valorization(&id, &4_900_000, &f.hash());
    f.assert_auth(
        &f.plant,
        "confirm_valorization",
        (id, 4_900_000u64, f.hash()).into_val(&f.env),
    );
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::Valorized);
    assert_eq!(batch.company, f.company);
    assert_eq!(batch.carrier, f.carrier);
    assert_eq!(batch.plant, f.plant);
    assert_eq!(batch.declared_mass, 5_100_000);
    assert_eq!(batch.pickup_mass, Some(5_000_000));
    assert_eq!(batch.received_mass, Some(4_950_000));
    assert_eq!(batch.valorized_mass, Some(4_900_000));
    assert_eq!(batch.evidence_hash, Some(f.hash()));
    assert_eq!(batch.created_at, 1_000);
    assert_eq!(batch.updated_at, 2_000);
    assert_eq!(batch.history.len(), 5);
    assert_eq!(
        batch.history.get(4).unwrap(),
        Transition {
            from: PreviousStatus::State(BatchStatus::Received),
            to: BatchStatus::Valorized,
            actor: f.plant.clone(),
            timestamp: 2_000,
            reason: None,
        }
    );
}

#[test]
fn valorization_equal_to_received_allowed() {
    let f = Fixture::new();
    let id = f.received();
    f.client().confirm_valorization(&id, &4_950_000, &f.hash());
    assert_eq!(f.client().get_batch(&id).valorized_mass, Some(4_950_000));
}

#[test]
fn valorization_above_received_rejected_without_changes() {
    let f = Fixture::new();
    let id = f.received();
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client()
            .try_confirm_valorization(&id, &4_950_001, &f.hash()),
        Err(Ok(RegistryError::MassExceedsReceived))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn duplicate_valorization_rejected_without_changes() {
    let f = Fixture::new();
    let id = f.received();
    f.client().confirm_valorization(&id, &4_900_000, &f.hash());
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client().try_confirm_valorization(&id, &1, &f.hash()),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn valorization_zero_mass_rejected() {
    let f = Fixture::new();
    let id = f.received();
    assert_eq!(
        f.client().try_confirm_valorization(&id, &0, &f.hash()),
        Err(Ok(RegistryError::InvalidMass))
    );
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Received);
}

#[test]
fn valorization_empty_hash_rejected() {
    let f = Fixture::new();
    let id = f.received();
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client()
            .try_confirm_valorization(&id, &1, &BytesN::from_array(&f.env, &[0; 32])),
        Err(Ok(RegistryError::InvalidEvidence))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn valorization_wrong_actor_rejected() {
    let f = Fixture::new();
    let id = f.received();
    let before = f.client().get_batch(&id);
    f.authorize_only(
        &f.company,
        "confirm_valorization",
        (id, 4_900_000u64, f.hash()).into_val(&f.env),
    );
    assert!(f
        .client()
        .try_confirm_valorization(&id, &4_900_000, &f.hash())
        .is_err());
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn missing_authorization_rejected() {
    let f = Fixture::new();
    let id = f.created();
    f.env.mock_auths(&[]);
    assert!(f.client().try_confirm_pickup(&id, &100).is_err());
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Created);
}

#[test]
fn state_skips_rejected() {
    let f = Fixture::new();
    let id = f.created();
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client().try_start_transit(&id),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_confirm_reception(&id, &100),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_confirm_valorization(&id, &100, &f.hash()),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn nonexistent_batch_returns_explicit_error() {
    let f = Fixture::new();
    assert_eq!(
        f.client().try_get_batch(&42),
        Err(Ok(RegistryError::BatchNotFound))
    );
    assert_eq!(
        f.client().try_confirm_pickup(&42, &1),
        Err(Ok(RegistryError::BatchNotFound))
    );
}

#[test]
fn cancellation_only_before_pickup_and_requires_company() {
    let f = Fixture::new();
    let id = f.created();
    f.client().cancel_batch(&id, &f.reason());
    f.assert_auth(
        &f.company,
        "cancel_batch",
        (id, f.reason()).into_val(&f.env),
    );
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::Cancelled);
    assert_eq!(batch.history.get(1).unwrap().reason, Some(f.reason()));
    assert_eq!(
        f.client().try_confirm_pickup(&id, &1),
        Err(Ok(RegistryError::InvalidState))
    );
    let other = f.picked_up();
    assert_eq!(
        f.client().try_cancel_batch(&other, &f.reason()),
        Err(Ok(RegistryError::InvalidState))
    );
}

#[test]
fn cancellation_wrong_actor_rejected() {
    let f = Fixture::new();
    let id = f.created();
    f.authorize_only(
        &f.carrier,
        "cancel_batch",
        (id, f.reason()).into_val(&f.env),
    );
    assert!(f.client().try_cancel_batch(&id, &f.reason()).is_err());
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Created);
}

#[test]
fn rejection_from_transit_does_not_invent_received_mass() {
    let f = Fixture::new();
    let id = f.in_transit();
    f.client().reject_batch(&id, &f.reason());
    f.assert_auth(&f.plant, "reject_batch", (id, f.reason()).into_val(&f.env));
    let batch = f.client().get_batch(&id);
    assert_eq!(batch.status, BatchStatus::Rejected);
    assert_eq!(batch.received_mass, None);
    assert_eq!(
        f.client().try_confirm_reception(&id, &1),
        Err(Ok(RegistryError::InvalidState))
    );
}

#[test]
fn rejection_from_received_preserves_mass_and_blocks_closure() {
    let f = Fixture::new();
    let id = f.received();
    f.client().reject_batch(&id, &f.reason());
    assert_eq!(f.client().get_batch(&id).received_mass, Some(4_950_000));
    assert_eq!(
        f.client().try_confirm_valorization(&id, &1, &f.hash()),
        Err(Ok(RegistryError::InvalidState))
    );
}

#[test]
fn rejection_wrong_actor_rejected() {
    let f = Fixture::new();
    let id = f.in_transit();
    f.authorize_only(
        &f.carrier,
        "reject_batch",
        (id, f.reason()).into_val(&f.env),
    );
    assert!(f.client().try_reject_batch(&id, &f.reason()).is_err());
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::InTransit);
}

#[test]
fn rejection_before_transit_rejected() {
    let f = Fixture::new();
    let id = f.picked_up();
    assert_eq!(
        f.client().try_reject_batch(&id, &f.reason()),
        Err(Ok(RegistryError::InvalidState))
    );
}

#[test]
fn dispute_accepts_each_assigned_actor_and_preserves_previous_state() {
    let f = Fixture::new();
    for actor in [&f.company, &f.carrier, &f.plant] {
        let id = f.received();
        f.client().dispute_batch(&id, actor, &f.reason());
        f.assert_auth(
            actor,
            "dispute_batch",
            (id, actor, f.reason()).into_val(&f.env),
        );
        let batch = f.client().get_batch(&id);
        assert_eq!(batch.status, BatchStatus::Disputed);
        assert_eq!(batch.received_mass, Some(4_950_000));
        assert_eq!(
            batch.history.last().unwrap().from,
            PreviousStatus::State(BatchStatus::Received)
        );
        assert_eq!(
            f.client().try_confirm_valorization(&id, &1, &f.hash()),
            Err(Ok(RegistryError::InvalidState))
        );
    }
}

#[test]
fn dispute_allows_all_active_states() {
    let f = Fixture::new();
    for id in [f.created(), f.picked_up(), f.in_transit(), f.received()] {
        f.client().dispute_batch(&id, &f.company, &f.reason());
        assert_eq!(f.client().get_batch(&id).status, BatchStatus::Disputed);
    }
}

#[test]
fn dispute_unrelated_actor_rejected() {
    let f = Fixture::new();
    let id = f.created();
    let outsider = Address::generate(&f.env);
    assert_eq!(
        f.client().try_dispute_batch(&id, &outsider, &f.reason()),
        Err(Ok(RegistryError::UnauthorizedActor))
    );
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Created);
}

#[test]
fn dispute_cannot_impersonate_assigned_actor() {
    let f = Fixture::new();
    let id = f.created();
    f.authorize_only(
        &f.carrier,
        "dispute_batch",
        (id, &f.company, f.reason()).into_val(&f.env),
    );
    assert!(f
        .client()
        .try_dispute_batch(&id, &f.company, &f.reason())
        .is_err());
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Created);
}

#[test]
fn exception_reason_required_and_bounded() {
    let f = Fixture::new();
    let id = f.created();
    for reason in [
        String::from_str(&f.env, ""),
        String::from_str(&f.env, " \n\t"),
        String::from_bytes(&f.env, &[b'a'; 257]),
    ] {
        assert_eq!(
            f.client().try_cancel_batch(&id, &reason),
            Err(Ok(RegistryError::InvalidReason))
        );
        assert_eq!(
            f.client().try_dispute_batch(&id, &f.company, &reason),
            Err(Ok(RegistryError::InvalidReason))
        );
    }
    assert_eq!(f.client().get_batch(&id).status, BatchStatus::Created);
    let received = f.received();
    assert_eq!(
        f.client()
            .try_reject_batch(&received, &String::from_str(&f.env, "")),
        Err(Ok(RegistryError::InvalidReason))
    );
}

#[test]
fn valorized_batch_cannot_go_back_or_enter_exception() {
    let f = Fixture::new();
    let id = f.received();
    f.client().confirm_valorization(&id, &1, &f.hash());
    let before = f.client().get_batch(&id);
    assert_eq!(
        f.client().try_confirm_pickup(&id, &1),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_start_transit(&id),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_confirm_reception(&id, &1),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_cancel_batch(&id, &f.reason()),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_reject_batch(&id, &f.reason()),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(
        f.client().try_dispute_batch(&id, &f.company, &f.reason()),
        Err(Ok(RegistryError::InvalidState))
    );
    assert_eq!(f.client().get_batch(&id), before);
}

#[test]
fn integer_grams_support_one_gram_and_maximum_u64() {
    let f = Fixture::new();
    for mass in [1, u64::MAX] {
        let id = f
            .client()
            .mock_all_auths()
            .create_batch(&f.company, &f.carrier, &f.plant, &mass);
        f.client().confirm_pickup(&id, &mass);
        f.client().start_transit(&id);
        f.client().confirm_reception(&id, &mass);
        f.client().confirm_valorization(&id, &mass, &f.hash());
        assert_eq!(f.client().get_batch(&id).valorized_mass, Some(mass));
    }
}

#[test]
fn id_overflow_cannot_reuse_a_batch_id() {
    let f = Fixture::new();
    f.env.as_contract(&f.contract, || {
        f.env
            .storage()
            .instance()
            .set(&storage::DataKey::LastId, &u64::MAX);
    });
    assert_eq!(
        f.client()
            .mock_all_auths()
            .try_create_batch(&f.company, &f.carrier, &f.plant, &1),
        Err(Ok(RegistryError::IdExhausted))
    );
}

#[test]
fn storage_lifetimes_are_extended() {
    use soroban_sdk::testutils::storage::{Instance, Persistent};
    let f = Fixture::new();
    let id = f.created();
    f.env.as_contract(&f.contract, || {
        assert!(f.env.storage().instance().get_ttl() >= 100_000);
        assert!(
            f.env
                .storage()
                .persistent()
                .get_ttl(&storage::DataKey::Batch(id))
                >= 100_000
        );
    });
}
