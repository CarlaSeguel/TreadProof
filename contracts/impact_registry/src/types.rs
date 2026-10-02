use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompanyImpact {
    pub company: Address,
    pub total_verified_grams: u128,
    pub credited_batch_count: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCredit {
    pub batch_id: u64,
    pub company: Address,
    pub verified_grams: u64,
    pub credited_at: u64,
}

/// Exact fixed-point presentation: whole TirePoints and remaining grams.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TirePoints {
    pub whole: u128,
    pub remainder_grams: u32,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ImpactError {
    NotInitialized = 1,
    AlreadyCredited = 2,
    BatchNotFound = 3,
    NotValorized = 4,
    InvalidMass = 5,
    InvalidEvidence = 6,
    SourceUnavailable = 7,
    InvalidBatch = 8,
    NumericOverflow = 9,
}
