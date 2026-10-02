use soroban_sdk::{contracterror, contracttype, Address, BytesN, String, Vec};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BatchStatus {
    Created,
    PickedUp,
    InTransit,
    Received,
    Valorized,
    Disputed,
    Rejected,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviousStatus {
    Creation,
    State(BatchStatus),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transition {
    pub from: PreviousStatus,
    pub to: BatchStatus,
    pub actor: Address,
    pub timestamp: u64,
    pub reason: Option<String>,
}

/// All masses are integer grams. Missing measurements are None, never zero.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TireBatch {
    pub id: u64,
    pub company: Address,
    pub carrier: Address,
    pub plant: Address,
    pub declared_mass: u64,
    pub pickup_mass: Option<u64>,
    pub received_mass: Option<u64>,
    pub valorized_mass: Option<u64>,
    pub evidence_hash: Option<BytesN<32>>,
    pub status: BatchStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub history: Vec<Transition>,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    BatchNotFound = 1,
    InvalidMass = 2,
    InvalidState = 3,
    MassExceedsReceived = 4,
    InvalidEvidence = 5,
    IdExhausted = 6,
    UnauthorizedActor = 7,
    InvalidReason = 8,
}
