#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, IntoVal, Vec,
};

// ─── Test helpers ──────────────────────────────────────────────────────────

/// Default expiration: 1000 seconds after the default ledger timestamp (0).
const DEFAULT_EXPIRATION: u64 = 1000;

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(AirdropContract, ());

    (env, admin, token_id, contract_id)
}

/// Mint `amount` tokens to `recipient` using the Stellar Asset Contract test utils.
fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

/// Build a simple two-leaf Merkle tree from two (addr, amount) pairs.
/// Returns (root, proof_for_leaf_0, proof_for_leaf_1).
fn build_two_leaf_tree(
    env: &Env,
    addr0: &Address,
    amt0: i128,
    addr1: &Address,
    amt1: i128,
) -> (BytesN<32>, Vec<BytesN<32>>, Vec<BytesN<32>>) {
    let leaf0 = merkle::leaf_hash(env, addr0, amt0);
    let leaf1 = merkle::leaf_hash(env, addr1, amt1);
    let root = merkle_pair(env, leaf0.clone(), leaf1.clone());

    let mut proof0 = Vec::new(env);
    proof0.push_back(leaf1);

    let mut proof1 = Vec::new(env);
    proof1.push_back(leaf0);

    (root, proof0, proof1)
}

fn merkle_pair(env: &Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
    use soroban_sdk::Bytes;
    let mut data = Bytes::new(env);
    let (first, second) = if a.as_ref() <= b.as_ref() { (a, b) } else { (b, a) };
    data.append(&first.into());
    data.append(&second.into());
    env.crypto().sha256(&data).into()
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_and_query() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    assert_eq!(client.merkle_root(), Some(root.clone()));
    assert_eq!(client.is_active(), true);
    assert_eq!(client.total_deposited(), 1500);
    assert_eq!(client.token(), Some(token.clone()));
    assert_eq!(client.admin(), Some(admin.clone()));
    assert!(!client.is_claimed(&claimant));
    assert_eq!(client.expiration(), Some(DEFAULT_EXPIRATION));
}

#[test]
fn test_claim_success() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, proof, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    assert_eq!(TokenClient::new(&env, &token).balance(&claimant), 0);

    client.claim(&claimant, &1000, &proof);

    assert_eq!(TokenClient::new(&env, &token).balance(&claimant), 1000);
    assert!(client.is_claimed(&claimant));
}

#[test]
fn test_double_claim_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, proof, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);
    client.claim(&claimant, &1000, &proof);

    let result = client.try_claim(&claimant, &1000, &proof);
    assert_eq!(result, Err(Ok(AirdropError::AlreadyClaimed)));
}

#[test]
fn test_invalid_proof_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let other = Address::generate(&env);

    let (root, _, proof1) = build_two_leaf_tree(&env, &claimant, 1000, &other, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Submit proof for `other` but claim as `claimant`
    let result = client.try_claim(&claimant, &500, &proof1);
    assert_eq!(result, Err(Ok(AirdropError::InvalidProof)));
}

#[test]
fn test_wrong_amount_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, proof, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Correct proof, wrong amount
    let result = client.try_claim(&claimant, &9999, &proof);
    assert_eq!(result, Err(Ok(AirdropError::InvalidProof)));
}

#[test]
fn test_pause_and_unpause() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, proof, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // ── Pause ────────────────────────────────────────────────────────────────
    client.set_active(&false);
    let result = client.try_claim(&claimant, &1000, &proof);
    assert_eq!(result, Err(Ok(AirdropError::NotActive)));

    // Verify the "paused" event was emitted for the pause call.
    // Events are indexed as (contract_id, topics...) → data.
    let events = env.events().all();
    let pause_event = events.iter().find(|(_contract, topics, data)| {
        let topics_val = topics.to_val();
        let data_val = data.to_val();
        // Topic tuple is (symbol_short!("paused"), admin); data is false.
        // We check the event exists by inspecting the last event that matches.
        let _ = (topics_val, data_val);
        // Use a simpler approach: check publish topics via IntoVal
        use soroban_sdk::IntoVal;
        *topics == (symbol_short!("paused"), admin.clone()).into_val(&env)
            && *data == false.into_val(&env)
    });
    assert!(pause_event.is_some(), "set_active(false) must emit a 'paused' event with data=false");

    // ── Unpause ──────────────────────────────────────────────────────────────
    client.set_active(&true);
    client.claim(&claimant, &1000, &proof); // succeeds again
    assert!(client.is_claimed(&claimant));

    // Verify the "paused" event was emitted for the unpause call.
    let events = env.events().all();
    let unpause_event = events.iter().find(|(_contract, topics, data)| {
        use soroban_sdk::IntoVal;
        *topics == (symbol_short!("paused"), admin.clone()).into_val(&env)
            && *data == true.into_val(&env)
    });
    assert!(unpause_event.is_some(), "set_active(true) must emit a 'paused' event with data=true");
}

/// Issue #12: set_active on an uninitialised contract must NOT emit an event —
/// it must return NotInitialized before reaching the publish call.
#[test]
fn test_set_active_uninitialized_no_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AirdropContract, ());
    let client = AirdropContractClient::new(&env, &contract_id);

    let result = client.try_set_active(&false);
    assert_eq!(
        result,
        Err(Ok(AirdropError::NotInitialized)),
        "set_active on uninitialized contract must return NotInitialized"
    );

    // No events should have been published.
    assert!(
        env.events().all().is_empty(),
        "No event should be emitted when set_active fails with NotInitialized"
    );
}

#[test]
fn test_reclaim_unclaimed_tokens() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Advance ledger timestamp past expiration.
    env.ledger().set_timestamp(DEFAULT_EXPIRATION);

    let reclaimed = client.reclaim();
    assert_eq!(reclaimed, 1500);
    assert_eq!(TokenClient::new(&env, &token).balance(&admin), 1500);
}

#[test]
fn test_reclaim_before_expiration_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    // Ledger timestamp is 0 by default; expiration is 1000.
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Attempt reclaim before expiration (timestamp 0 < expiration 1000).
    let result = client.try_reclaim();
    assert_eq!(result, Err(Ok(AirdropError::NotYetExpired)));
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 3000);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    let result = client.try_initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);
    assert_eq!(result, Err(Ok(AirdropError::AlreadyInitialized)));
}

#[test]
fn test_zero_amount_claim_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_claim(&claimant, &0, &empty_proof);
    assert_eq!(result, Err(Ok(AirdropError::ZeroAmount)));
}

// ─── Issue #61: TTL extension on read queries ───────────────────────────────

/// Helper: returns the instance TTL (live-until ledger) after setup.
/// We verify that calling a query bumps the TTL to at least
/// `current_sequence + INSTANCE_TTL_THRESHOLD`.
///
/// Soroban's test environment starts at sequence 0 and the default TTL after
/// `extend_ttl(THRESHOLD, TTL)` is `sequence + TTL`.  We just check that
/// `get_ttl()` is > 0, which proves extend_ttl was called (without it, fresh
/// instance storage has a minimal default TTL close to 0).
#[test]
fn test_query_merkle_root_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    let ttl_before = env.storage().instance().get_ttl();
    // Simulate many ledgers passing without a claim — TTL would drop.
    // We reset it to 1 to emulate a near-archived contract.
    env.storage().instance().extend_ttl(1, 1);

    client.merkle_root();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "merkle_root() must refresh instance TTL; ttl_before={ttl_before}, ttl_after={ttl_after}"
    );
}

#[test]
fn test_query_is_claimed_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.is_claimed(&claimant);

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "is_claimed() must refresh instance TTL; got {ttl_after}");
}

#[test]
fn test_query_is_active_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.is_active();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "is_active() must refresh instance TTL; got {ttl_after}");
}

#[test]
fn test_query_token_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.token();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "token() must refresh instance TTL; got {ttl_after}");
}

#[test]
fn test_query_admin_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.admin();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "admin() must refresh instance TTL; got {ttl_after}");
}

#[test]
fn test_query_total_deposited_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.total_deposited();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "total_deposited() must refresh instance TTL; got {ttl_after}");
}

#[test]
fn test_query_expiration_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    env.storage().instance().extend_ttl(1, 1);
    client.expiration();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(ttl_after > 1, "expiration() must refresh instance TTL; got {ttl_after}");
}

// ─── Issue 3: Negative amount tests ────────────────────────────────────────

#[test]
fn test_negative_total_amount_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    // Do NOT mint — the rejection should happen before the transfer.
    let result = client.try_initialize(&admin, &token, &root, &-1, &DEFAULT_EXPIRATION);
    assert_eq!(result, Err(Ok(AirdropError::ZeroAmount)));
}

#[test]
fn test_negative_claim_amount_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, proof, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    let result = client.try_claim(&claimant, &-1, &proof);
    assert_eq!(result, Err(Ok(AirdropError::ZeroAmount)));
}

// ─── Issue 4: Non-admin authorization tests ─────────────────────────────────

/// A non-admin address calling `set_active` must fail authorization.
#[test]
#[should_panic]
fn test_non_admin_set_active_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let non_admin = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Override mock_all_auths: only authorize non_admin, not the real admin.
    // The contract checks `admin.require_auth()` where admin is the stored address,
    // so authorizing a different address must cause a panic.
    env.set_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_active",
            args: (false,).into_val(&env),
            sub_invokes: &[],
        },
    }.into()]);

    // This should panic because the stored admin's auth is not satisfied.
    client.set_active(&false);
}

/// A non-admin address calling `reclaim` must fail authorization.
#[test]
#[should_panic]
fn test_non_admin_reclaim_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let non_admin = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Advance past expiration so the time-gate is not the failure point.
    env.ledger().set_timestamp(DEFAULT_EXPIRATION);

    // Only authorize non_admin, not the real admin.
    env.set_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "reclaim",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }.into()]);

    // This should panic because the stored admin's auth is not satisfied.
    client.reclaim();
}

// ─── Issue 6: Cross-language leaf-hash test vector ─────────────────────────

/// Cross-language test vector: proves that `merkle::leaf_hash` in Rust
/// produces byte-for-byte identical output to `leafHash()` in the TypeScript
/// SDK for the same (address, amount) inputs.
///
/// The expected value was produced by running the ACTUAL compiled TypeScript
/// SDK (`sdk/src/merkle.ts`) with:
///
///   address = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
///   amount  = 1_000_000n
///
///   $ node -e "
///     const { leafHash } = require('./sdk/dist/merkle.js');
///     console.log(leafHash('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', 1000000n).toString('hex'));
///   "
///   => 7c7175b951be4c0bc42331708840f397c148788c8911a7cf1b0622f288b3a6ce
///
/// The expected bytes are pasted verbatim — no hashing is performed in this
/// test. If Rust and TypeScript disagree, this test fails.
#[test]
fn test_leaf_hash_known_vector() {
    let env = Env::default();

    let address = Address::from_str(
        &env,
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
    let amount: i128 = 1_000_000;

    // Expected value: output of the TypeScript SDK's leafHash() for the same
    // inputs. Pasted literally — not computed by any Rust hashing logic.
    let expected = BytesN::from_array(&env, &[
        0x7c, 0x71, 0x75, 0xb9, 0x51, 0xbe, 0x4c, 0x0b,
        0xc4, 0x23, 0x31, 0x70, 0x88, 0x40, 0xf3, 0x97,
        0xc1, 0x48, 0x78, 0x8c, 0x89, 0x11, 0xa7, 0xcf,
        0x1b, 0x06, 0x22, 0xf2, 0x88, 0xb3, 0xa6, 0xce,
    ]);

    let actual = merkle::leaf_hash(&env, &address, amount);
    assert_eq!(
        actual, expected,
        "Rust leaf_hash does not match TypeScript SDK output — the two implementations disagree"
    );
}

// ─── Issue #62: restore() helper ───────────────────────────────────────────

/// restore() should extend the instance TTL even when called by a random
/// address (no auth required).
#[test]
fn test_restore_extends_ttl() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Simulate near-archival: force TTL down to 1.
    env.storage().instance().extend_ttl(1, 1);
    let ttl_before = env.storage().instance().get_ttl();
    assert_eq!(ttl_before, 1, "TTL should be 1 before restore");

    // Anyone can call restore() — no auth needed.
    client.restore();

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "restore() must extend instance TTL; ttl_after={ttl_after}"
    );
}

/// restore() requires no authentication — even a fresh Address can call it.
#[test]
fn test_restore_requires_no_auth() {
    let env = Env::default();
    // Do NOT mock all auths — this verifies restore() passes without any auth.
    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(AirdropContract, ());
    let client = AirdropContractClient::new(&env, &contract_id);

    // Initialize using mock auth just for setup.
    env.mock_all_auths();
    let claimant = Address::generate(&env);
    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token_id, &admin, &admin, 1500);
    client.initialize(&admin, &token_id, &root, &1500, &DEFAULT_EXPIRATION);
    // Clear mock auths so subsequent calls must be auth-free.
    env.set_auths(&[]);

    // restore() must succeed without any signed auth.
    client.restore(); // panics if auth is required
}
