#![no_std]

mod storage;
mod types;

pub use types::{BatchStatus, PreviousStatus, RegistryError, TireBatch, Transition};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};

#[contract]
pub struct TireRegistry;

#[contractimpl]
impl TireRegistry {
    /// IDs are monotonically increasing and unique within this contract instance.
    pub fn create_batch(
        env: Env,
        company: Address,
        carrier: Address,
        plant: Address,
        declared_mass: u64,
    ) -> Result<u64, RegistryError> {
        company.require_auth();
        positive_mass(declared_mass)?;
        let id = storage::next_id(&env)?;
        let timestamp = env.ledger().timestamp();
        let mut history = Vec::new(&env);
        history.push_back(Transition {
            from: PreviousStatus::Creation,
            to: BatchStatus::Created,
            actor: company.clone(),
            timestamp,
            reason: None,
        });
        storage::save(
            &env,
            &TireBatch {
                id,
                company,
                carrier,
                plant,
                declared_mass,
                pickup_mass: None,
                received_mass: None,
                valorized_mass: None,
                evidence_hash: None,
                status: BatchStatus::Created,
                created_at: timestamp,
                updated_at: timestamp,
                history,
            },
        );
        Ok(id)
    }

    pub fn confirm_pickup(env: Env, id: u64, pickup_mass: u64) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.carrier.require_auth();
        expect_state(&batch, BatchStatus::Created)?;
        positive_mass(pickup_mass)?;
        batch.pickup_mass = Some(pickup_mass);
        let actor = batch.carrier.clone();
        transition(&env, &mut batch, BatchStatus::PickedUp, actor, None);
        Ok(())
    }

    pub fn start_transit(env: Env, id: u64) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.carrier.require_auth();
        expect_state(&batch, BatchStatus::PickedUp)?;
        let actor = batch.carrier.clone();
        transition(&env, &mut batch, BatchStatus::InTransit, actor, None);
        Ok(())
    }

    pub fn confirm_reception(env: Env, id: u64, received_mass: u64) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.plant.require_auth();
        expect_state(&batch, BatchStatus::InTransit)?;
        positive_mass(received_mass)?;
        batch.received_mass = Some(received_mass);
        let actor = batch.plant.clone();
        transition(&env, &mut batch, BatchStatus::Received, actor, None);
        Ok(())
    }

    /// Records a plant's attestation only; this phase does not award TirePoints.
    pub fn confirm_valorization(
        env: Env,
        id: u64,
        valorized_mass: u64,
        evidence_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.plant.require_auth();
        expect_state(&batch, BatchStatus::Received)?;
        positive_mass(valorized_mass)?;
        let received = batch.received_mass.ok_or(RegistryError::InvalidState)?;
        if valorized_mass > received {
            return Err(RegistryError::MassExceedsReceived);
        }
        if evidence_hash == BytesN::from_array(&env, &[0; 32]) {
            return Err(RegistryError::InvalidEvidence);
        }
        batch.valorized_mass = Some(valorized_mass);
        batch.evidence_hash = Some(evidence_hash);
        let actor = batch.plant.clone();
        transition(&env, &mut batch, BatchStatus::Valorized, actor, None);
        Ok(())
    }

    /// Public on-chain data. No documents or private business details are stored.
    pub fn get_batch(env: Env, id: u64) -> Result<TireBatch, RegistryError> {
        let batch = storage::load(&env, id)?;
        storage::extend(&env, id);
        Ok(batch)
    }

    pub fn cancel_batch(env: Env, id: u64, reason: String) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.company.require_auth();
        expect_state(&batch, BatchStatus::Created)?;
        validate_reason(&reason)?;
        let actor = batch.company.clone();
        transition(
            &env,
            &mut batch,
            BatchStatus::Cancelled,
            actor,
            Some(reason),
        );
        Ok(())
    }

    pub fn reject_batch(env: Env, id: u64, reason: String) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        batch.plant.require_auth();
        if !matches!(batch.status, BatchStatus::InTransit | BatchStatus::Received) {
            return Err(RegistryError::InvalidState);
        }
        validate_reason(&reason)?;
        let actor = batch.plant.clone();
        transition(&env, &mut batch, BatchStatus::Rejected, actor, Some(reason));
        Ok(())
    }

    pub fn dispute_batch(
        env: Env,
        id: u64,
        actor: Address,
        reason: String,
    ) -> Result<(), RegistryError> {
        let mut batch = storage::load(&env, id)?;
        actor.require_auth();
        if actor != batch.company && actor != batch.carrier && actor != batch.plant {
            return Err(RegistryError::UnauthorizedActor);
        }
        if !matches!(
            batch.status,
            BatchStatus::Created
                | BatchStatus::PickedUp
                | BatchStatus::InTransit
                | BatchStatus::Received
        ) {
            return Err(RegistryError::InvalidState);
        }
        validate_reason(&reason)?;
        transition(&env, &mut batch, BatchStatus::Disputed, actor, Some(reason));
        Ok(())
    }
}

fn positive_mass(mass: u64) -> Result<(), RegistryError> {
    if mass == 0 {
        Err(RegistryError::InvalidMass)
    } else {
        Ok(())
    }
}

fn expect_state(batch: &TireBatch, expected: BatchStatus) -> Result<(), RegistryError> {
    if batch.status != expected {
        Err(RegistryError::InvalidState)
    } else {
        Ok(())
    }
}

fn validate_reason(reason: &String) -> Result<(), RegistryError> {
    if reason.is_empty() || reason.len() > 256 {
        return Err(RegistryError::InvalidReason);
    }
    let mut buffer = [0u8; 256];
    reason.copy_into_slice(&mut buffer[..reason.len() as usize]);
    if buffer[..reason.len() as usize]
        .iter()
        .all(u8::is_ascii_whitespace)
    {
        return Err(RegistryError::InvalidReason);
    }
    Ok(())
}

fn transition(
    env: &Env,
    batch: &mut TireBatch,
    next: BatchStatus,
    actor: Address,
    reason: Option<String>,
) {
    let timestamp = env.ledger().timestamp();
    batch.history.push_back(Transition {
        from: PreviousStatus::State(batch.status),
        to: next,
        actor,
        timestamp,
        reason,
    });
    batch.status = next;
    batch.updated_at = timestamp;
    storage::save(env, batch);
}

#[cfg(test)]
mod test;
