use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BadgeLevel {
    Trace,
    Recover,
    Circular,
    Impact,
    Champion,
}

pub(crate) const LEVELS: [BadgeLevel; 5] = [
    BadgeLevel::Trace,
    BadgeLevel::Recover,
    BadgeLevel::Circular,
    BadgeLevel::Impact,
    BadgeLevel::Champion,
];

impl BadgeLevel {
    pub(crate) fn threshold_grams(self) -> u128 {
        match self {
            Self::Trace => 1_000_000,
            Self::Recover => 10_000_000,
            Self::Circular => 25_000_000,
            Self::Impact => 50_000_000,
            Self::Champion => 100_000_000,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeRecord {
    pub company: Address,
    pub level: BadgeLevel,
    pub unlocked_at: u64,
    pub unlocked_ledger: u32,
    pub verified_grams: u128,
    pub credited_batch_count: u64,
    pub threshold_grams: u128,
    pub rules_version: u32,
    pub impact_registry: Address,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BadgeError {
    NotInitialized = 1,
    SourceUnavailable = 2,
    InvalidCompany = 3,
}
