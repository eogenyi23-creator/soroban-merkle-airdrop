//! Data types and storage keys for the Merkle airdrop contract.

use soroban_sdk::{contracttype, contracterror, Address, BytesN};

/// A leaf in the Merkle tree: the claimant address and the amount they can claim.
///
/// Leaf hash = SHA-256(address_bytes ++ amount_bytes_big_endian)
#[contracttype]
#[derive(Clone, Debug)]
pub struct AirdropEntry {
    pub claimant: Address,
    pub amount: i128,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// The Merkle root (32-byte hash) of the airdrop distribution tree.
    MerkleRoot,
    /// The SEP-41 token contract address being distributed.
    TokenAddress,
    /// Admin — can initialise and optionally reclaim unclaimed tokens.
    Admin,
    /// Whether this claimant has already claimed (prevents double-claiming).
    Claimed(Address),
    /// Total tokens deposited into the contract.
    TotalDeposited,
    /// Whether the airdrop is active (admin can pause).
    Active,
}

/// Errors returned by the airdrop contract.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AirdropError {
    /// Contract has already been initialised.
    AlreadyInitialized = 1,
    /// Caller has already claimed their allocation.
    AlreadyClaimed = 2,
    /// The Merkle proof supplied does not verify against the root.
    InvalidProof = 3,
    /// Amount in proof does not match the leaf.
    InvalidAmount = 4,
    /// Contract is not currently active.
    NotActive = 5,
    /// Caller is not the admin.
    Unauthorized = 6,
    /// Contract has not been initialised yet.
    NotInitialized = 7,
    /// Zero amount is not claimable.
    ZeroAmount = 8,
}
