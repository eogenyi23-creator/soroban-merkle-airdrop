//! soroban-merkle-airdrop
//!
//! Gas-efficient token distribution using Merkle proofs on Stellar.
//!
//! Instead of batch-transferring tokens to thousands of addresses up-front,
//! this contract stores only a single 32-byte Merkle root on-chain. Recipients
//! prove their inclusion by supplying a Merkle proof and claiming their tokens
//! themselves — paying only for their own transaction.
//!
//! # Flow
//!
//! 1. **Organiser** builds a Merkle tree off-chain from a list of
//!    `(address, amount)` pairs using the TypeScript SDK.
//! 2. **Organiser** deploys this contract and calls `initialize` with the
//!    Merkle root, the SEP-41 token address, and deposits the total supply.
//! 3. **Recipients** call `claim` with their amount and Merkle proof.
//!    The contract verifies the proof, marks the address as claimed, and
//!    transfers the tokens.
//!
//! # Storage layout
//!
//! - `DataKey::MerkleRoot`          → `BytesN<32>`  (instance)
//! - `DataKey::TokenAddress`        → `Address`     (instance)
//! - `DataKey::Admin`               → `Address`     (instance)
//! - `DataKey::TotalDeposited`      → `i128`        (instance)
//! - `DataKey::Active`              → `bool`        (instance)
//! - `DataKey::Claimed(addr)`       → `bool`        (persistent, per claimant)

#![no_std]

mod merkle;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contractmeta, symbol_short,
    token::Client as TokenClient,
    Address, BytesN, Env, Vec,
};
use types::{AirdropError, DataKey};

contractmeta!(
    key = "Description",
    val = "Merkle tree airdrop contract for gas-efficient token distribution on Stellar"
);
contractmeta!(key = "Version", val = "0.1.0");

/// TTL for per-claimant `Claimed` entries — ~2 years of ledgers.
const CLAIMED_TTL: u32 = 12_614_400;
const CLAIMED_TTL_THRESHOLD: u32 = CLAIMED_TTL / 2;

#[contract]
pub struct AirdropContract;

#[contractimpl]
impl AirdropContract {
    // ─── Initialisation ──────────────────────────────────────────────────────

    /// Initialise the airdrop.
    ///
    /// Must be called once before any claims. The caller deposits `total_amount`
    /// tokens from the SEP-41 token contract into this contract.
    ///
    /// # Arguments
    ///
    /// * `admin`        - Address that controls the airdrop (can pause/reclaim).
    /// * `token`        - SEP-41 token contract address to distribute.
    /// * `merkle_root`  - 32-byte Merkle root of the (address, amount) tree.
    /// * `total_amount` - Total tokens to be distributed; transferred from admin.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        merkle_root: BytesN<32>,
        total_amount: i128,
    ) -> Result<(), AirdropError> {
        if env.storage().instance().has(&DataKey::MerkleRoot) {
            return Err(AirdropError::AlreadyInitialized);
        }
        if total_amount == 0 {
            return Err(AirdropError::ZeroAmount);
        }

        admin.require_auth();

        // Transfer tokens from admin into the contract.
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(
            &admin,
            &env.current_contract_address(),
            &total_amount,
        );

        env.storage().instance().set(&DataKey::MerkleRoot, &merkle_root);
        env.storage().instance().set(&DataKey::TokenAddress, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalDeposited, &total_amount);
        env.storage().instance().set(&DataKey::Active, &true);

        env.events().publish(
            (symbol_short!("init"), admin),
            (merkle_root, total_amount),
        );

        Ok(())
    }

    // ─── Claim ───────────────────────────────────────────────────────────────

    /// Claim tokens from the airdrop.
    ///
    /// The claimant provides their allocation `amount` and a Merkle `proof`
    /// demonstrating they are in the distribution tree. Tokens are transferred
    /// immediately on success.
    ///
    /// # Arguments
    ///
    /// * `claimant` - Address claiming tokens (must sign the transaction).
    /// * `amount`   - Token amount allocated to this claimant.
    /// * `proof`    - Ordered list of sibling hashes from leaf to root.
    pub fn claim(
        env: Env,
        claimant: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) -> Result<(), AirdropError> {
        claimant.require_auth();

        // Check active.
        let active: bool = env
            .storage()
            .instance()
            .get(&DataKey::Active)
            .ok_or(AirdropError::NotInitialized)?;
        if !active {
            return Err(AirdropError::NotActive);
        }

        if amount == 0 {
            return Err(AirdropError::ZeroAmount);
        }

        // Check not already claimed.
        let claimed_key = DataKey::Claimed(claimant.clone());
        if env.storage().persistent().has(&claimed_key) {
            return Err(AirdropError::AlreadyClaimed);
        }

        // Verify Merkle proof.
        let root: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::MerkleRoot)
            .ok_or(AirdropError::NotInitialized)?;

        let leaf = merkle::leaf_hash(&env, &claimant, amount);
        let proof_slice: soroban_sdk::Vec<BytesN<32>> = proof;
        let proof_vec: std::vec::Vec<BytesN<32>> = proof_slice.iter().collect();

        if !merkle::verify_proof(&env, &root, leaf, &proof_vec) {
            return Err(AirdropError::InvalidProof);
        }

        // Mark as claimed before transfer (re-entrancy guard).
        env.storage().persistent().set(&claimed_key, &true);
        env.storage().persistent().extend_ttl(
            &claimed_key,
            CLAIMED_TTL_THRESHOLD,
            CLAIMED_TTL,
        );

        // Transfer tokens to claimant.
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .unwrap();
        TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &claimant,
            &amount,
        );

        env.events().publish(
            (symbol_short!("claimed"), claimant.clone()),
            amount,
        );

        Ok(())
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// Pause or unpause the airdrop. Only the admin can call this.
    pub fn set_active(env: Env, active: bool) -> Result<(), AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Active, &active);
        Ok(())
    }

    /// Reclaim unclaimed tokens after the airdrop ends. Admin only.
    ///
    /// Transfers the contract's remaining token balance back to the admin.
    pub fn reclaim(env: Env) -> Result<i128, AirdropError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AirdropError::NotInitialized)?;
        admin.require_auth();

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .unwrap();
        let token_client = TokenClient::new(&env, &token);
        let balance = token_client.balance(&env.current_contract_address());

        if balance > 0 {
            token_client.transfer(&env.current_contract_address(), &admin, &balance);
        }

        env.events()
            .publish((symbol_short!("reclaimed"), admin), balance);

        Ok(balance)
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /// Return the Merkle root stored in this contract.
    pub fn merkle_root(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::MerkleRoot)
    }

    /// Return `true` if `claimant` has already claimed.
    pub fn is_claimed(env: Env, claimant: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Claimed(claimant))
    }

    /// Return whether the airdrop is currently active.
    pub fn is_active(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Active)
            .unwrap_or(false)
    }

    /// Return the token contract address.
    pub fn token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TokenAddress)
    }

    /// Return the admin address.
    pub fn admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Return total tokens deposited at initialisation.
    pub fn total_deposited(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposited)
            .unwrap_or(0)
    }
}
