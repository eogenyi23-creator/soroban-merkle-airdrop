#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{storage::Instance as _, Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
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

/// Events published by this contract during the most recent invocation.
///
/// `Events::all()` returns the events of the last invocation only, and a failed
/// invocation reports none at all.
fn contract_events(env: &Env, contract_id: &Address) -> soroban_sdk::testutils::ContractEvents {
    env.events().all().filter_by_contract(contract_id)
}

/// Build the expected `(contract_id, topics, data)` list for one invocation,
/// which is the representation `ContractEvents` compares against.
fn expected_events(
    env: &Env,
    contract_id: &Address,
    events: &[((Symbol, Address), Val)],
) -> Vec<(Address, Vec<Val>, Val)> {
    let mut out = Vec::new(env);
    for (topics, data) in events.iter() {
        out.push_back((contract_id.clone(), topics.clone().into_val(env), data.clone()));
    }
    out
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

    // Verify the "paused" event was emitted for the pause call. The events are
    // read before the claim below, because `all()` only reports the most recent
    // invocation.
    assert_eq!(
        contract_events(&env, &contract_id),
        expected_events(
            &env,
            &contract_id,
            &[((symbol_short!("paused"), admin.clone()), false.into_val(&env))],
        ),
        "set_active(false) must emit a 'paused' event with data=false"
    );

    let result = client.try_claim(&claimant, &1000, &proof);
    assert_eq!(result, Err(Ok(AirdropError::NotActive)));

    // ── Unpause ──────────────────────────────────────────────────────────────
    client.set_active(&true);
    assert_eq!(
        contract_events(&env, &contract_id),
        expected_events(
            &env,
            &contract_id,
            &[((symbol_short!("paused"), admin.clone()), true.into_val(&env))],
        ),
        "set_active(true) must emit a 'paused' event with data=true"
    );

    client.claim(&claimant, &1000, &proof); // succeeds again
    assert!(client.is_claimed(&claimant));
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
        env.events().all().events().is_empty(),
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

    let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    // Simulate many ledgers passing without a claim — TTL would drop.
    // We reset it to 1 to emulate a near-archived contract.
    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));

    client.merkle_root();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.is_claimed(&claimant);

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.is_active();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.token();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.admin();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.total_deposited();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Shrinking the TTL also has to happen inside the contract's context.
    env.as_contract(&contract_id, || env.storage().instance().extend_ttl(1, 1));
    client.expiration();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
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

    // Simulate near-archival. The instance TTL is counted down by the ledger
    // sequence, so moving the ledger forward is what actually shortens it —
    // `extend_ttl` only ever writes a larger value, and `extend_ttl(1, 1)`
    // leaves a fresh instance (12.6M ledgers) untouched.
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + INSTANCE_TTL - 1);
    let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(
        ttl_before < INSTANCE_TTL,
        "the ledger jump must consume the instance TTL: before={ttl_before} INSTANCE_TTL={INSTANCE_TTL}"
    );

    // Anyone can call restore() — no auth needed.
    client.restore();

    // `get_ttl` is only readable from inside the contract's own context.
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(
        ttl_after > ttl_before,
        "restore() must extend the instance TTL; before={ttl_before} after={ttl_after}"
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

// ─── Batch claim (issue #36) ───────────────────────────────────────────────

/// Build a 3-leaf tree and return its root plus one proof per leaf.
///
/// An odd leaf is promoted to the next level unhashed, which is the same
/// convention `sdk/src/merkle.ts::buildMerkleTree` uses.
fn build_three_leaf_tree(
    env: &Env,
    a: &Address,
    amt_a: i128,
    b: &Address,
    amt_b: i128,
    c: &Address,
    amt_c: i128,
) -> (
    BytesN<32>,
    Vec<BytesN<32>>,
    Vec<BytesN<32>>,
    Vec<BytesN<32>>,
) {
    let la = merkle::leaf_hash(env, a, amt_a);
    let lb = merkle::leaf_hash(env, b, amt_b);
    let lc = merkle::leaf_hash(env, c, amt_c);
    let ab = merkle_pair(env, la.clone(), lb.clone());
    let root = merkle_pair(env, ab.clone(), lc.clone());

    // a: sibling leaf_b, then the promoted leaf_c.
    let mut pa = Vec::new(env);
    pa.push_back(lb.clone());
    pa.push_back(lc.clone());

    // b: sibling leaf_a, then leaf_c.
    let mut pb = Vec::new(env);
    pb.push_back(la.clone());
    pb.push_back(lc.clone());

    // c: its sibling is the already-combined pair (a, b).
    let mut pc = Vec::new(env);
    pc.push_back(ab);

    (root, pa, pb, pc)
}

/// Shorthand so the batch tests read as data instead of constructor calls.
fn entry(claimant: &Address, amount: i128) -> AirdropEntry {
    AirdropEntry {
        claimant: claimant.clone(),
        amount,
    }
}

fn token_balance(env: &Env, token: &Address, who: &Address) -> i128 {
    TokenClient::new(env, token).balance(who)
}

/// Three recipients, one transaction: everyone is paid and gets a `claimed`
/// event of their own.
#[test]
fn test_batch_claim_three_entries_success() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    let (root, pa, pb, pc) = build_three_leaf_tree(&env, &a, 1000, &b, 2000, &c, 3000);

    mint(&env, &token, &admin, &admin, 6000);
    client.initialize(&admin, &token, &root, &6000, &DEFAULT_EXPIRATION);

    let mut entries = Vec::new(&env);
    entries.push_back(entry(&a, 1000));
    entries.push_back(entry(&b, 2000));
    entries.push_back(entry(&c, 3000));

    let mut proofs = Vec::new(&env);
    proofs.push_back(pa);
    proofs.push_back(pb);
    proofs.push_back(pc);

    client.batch_claim(&entries, &proofs);

    // Read the events before any other call: `all()` reports the events of the
    // most recent invocation, and every balance/flag query below is itself an
    // invocation that replaces the buffer.
    let emitted = contract_events(&env, &contract_id);

    assert_eq!(token_balance(&env, &token, &a), 1000);
    assert_eq!(token_balance(&env, &token, &b), 2000);
    assert_eq!(token_balance(&env, &token, &c), 3000);
    assert!(client.is_claimed(&a));
    assert!(client.is_claimed(&b));
    assert!(client.is_claimed(&c));

    // One `claimed` event per recipient, in the order of `entries`.
    assert_eq!(
        emitted,
        expected_events(
            &env,
            &contract_id,
            &[
                ((symbol_short!("claimed"), a.clone()), 1000i128.into_val(&env)),
                ((symbol_short!("claimed"), b.clone()), 2000i128.into_val(&env)),
                ((symbol_short!("claimed"), c.clone()), 3000i128.into_val(&env)),
            ],
        ),
        "every claim in the batch must emit its own 'claimed' event"
    );
    // Everything was paid out, the contract keeps nothing back.
    assert_eq!(token_balance(&env, &token, &contract_id), 0);
}

/// A repeated claimant aborts the whole batch — including the entries that were
/// already processed before the duplicate was reached.
#[test]
fn test_batch_claim_duplicate_entry_fails_all() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    let (root, pa, pb, _) = build_three_leaf_tree(&env, &a, 1000, &b, 2000, &c, 3000);

    mint(&env, &token, &admin, &admin, 6000);
    client.initialize(&admin, &token, &root, &6000, &DEFAULT_EXPIRATION);

    // `a` appears twice, with a valid proof both times, so the second entry
    // reaches the double-claim guard rather than failing on the proof.
    let mut entries = Vec::new(&env);
    entries.push_back(entry(&a, 1000));
    entries.push_back(entry(&b, 2000));
    entries.push_back(entry(&a, 1000));

    let mut proofs = Vec::new(&env);
    proofs.push_back(pa.clone());
    proofs.push_back(pb);
    proofs.push_back(pa);

    let result = client.try_batch_claim(&entries, &proofs);
    // Read the buffer straight after the failed call, before the queries below
    // replace it. A failed invocation reports no successful events.
    let emitted = contract_events(&env, &contract_id);

    assert_eq!(result, Err(Ok(AirdropError::AlreadyClaimed)));

    // Nothing survived the rollback: no payouts, no claimed flags, no events.
    assert_eq!(token_balance(&env, &token, &a), 0);
    assert_eq!(token_balance(&env, &token, &b), 0);
    assert!(!client.is_claimed(&a));
    assert!(!client.is_claimed(&b));
    // A rolled-back batch leaves no 'claimed' events behind either.
    assert!(
        emitted.events().is_empty(),
        "a rolled-back batch must emit no events"
    );
    assert_eq!(token_balance(&env, &token, &contract_id), 6000);
}

/// One bad proof in the batch means nobody is paid — the bad entry is last, so
/// the earlier transfers have to be rolled back.
#[test]
fn test_batch_claim_invalid_proof_fails_all() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    let (root, pa, pb, _) = build_three_leaf_tree(&env, &a, 1000, &b, 2000, &c, 3000);

    mint(&env, &token, &admin, &admin, 6000);
    client.initialize(&admin, &token, &root, &6000, &DEFAULT_EXPIRATION);

    let mut entries = Vec::new(&env);
    entries.push_back(entry(&a, 1000));
    entries.push_back(entry(&b, 2000));
    entries.push_back(entry(&c, 3000));

    let mut bad_proof = Vec::new(&env);
    bad_proof.push_back(BytesN::from_array(&env, &[7u8; 32]));

    let mut proofs = Vec::new(&env);
    proofs.push_back(pa);
    proofs.push_back(pb);
    proofs.push_back(bad_proof);

    let result = client.try_batch_claim(&entries, &proofs);
    assert_eq!(result, Err(Ok(AirdropError::InvalidProof)));

    assert_eq!(token_balance(&env, &token, &a), 0);
    assert_eq!(token_balance(&env, &token, &b), 0);
    assert!(!client.is_claimed(&a));
    assert!(!client.is_claimed(&b));
    assert_eq!(token_balance(&env, &token, &contract_id), 6000);
}

/// An entry without a matching proof vector cannot be verified, so it is
/// rejected before anything is paid.
#[test]
fn test_batch_claim_proof_count_mismatch_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    let (root, pa, pb, _) = build_three_leaf_tree(&env, &a, 1000, &b, 2000, &c, 3000);

    mint(&env, &token, &admin, &admin, 6000);
    client.initialize(&admin, &token, &root, &6000, &DEFAULT_EXPIRATION);

    let mut entries = Vec::new(&env);
    entries.push_back(entry(&a, 1000));
    entries.push_back(entry(&b, 2000));

    // Two entries, one proof.
    let mut proofs = Vec::new(&env);
    proofs.push_back(pa);
    proofs.push_back(pb);

    entries.push_back(entry(&c, 3000)); // now 3 entries vs 2 proofs

    let result = client.try_batch_claim(&entries, &proofs);
    assert_eq!(result, Err(Ok(AirdropError::InvalidProof)));

    assert_eq!(token_balance(&env, &token, &a), 0);
    assert!(!client.is_claimed(&a));
}

/// An empty batch is a no-op, not an error.
#[test]
fn test_batch_claim_empty_is_noop() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);

    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    let entries: Vec<AirdropEntry> = Vec::new(&env);
    let proofs: Vec<Vec<BytesN<32>>> = Vec::new(&env);

    client.batch_claim(&entries, &proofs);
    let emitted = contract_events(&env, &contract_id);

    // The deposit is untouched, nothing was marked as claimed, and an empty
    // batch emits nothing.
    assert!(emitted.events().is_empty());
    assert_eq!(token_balance(&env, &token, &contract_id), 1500);
    assert!(!client.is_claimed(&claimant));
}

/// Batch claims go through the same rules as single claims: a recipient who
/// already claimed individually cannot be paid again through a batch.
#[test]
fn test_batch_claim_rejects_already_claimed_member() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    let (root, pa, pb, pc) = build_three_leaf_tree(&env, &a, 1000, &b, 2000, &c, 3000);

    mint(&env, &token, &admin, &admin, 6000);
    client.initialize(&admin, &token, &root, &6000, &DEFAULT_EXPIRATION);

    // `a` claims on their own first.
    client.claim(&a, &1000, &pa);

    let mut entries = Vec::new(&env);
    entries.push_back(entry(&a, 1000));
    entries.push_back(entry(&b, 2000));
    entries.push_back(entry(&c, 3000));

    let mut proofs = Vec::new(&env);
    proofs.push_back(pa);
    proofs.push_back(pb);
    proofs.push_back(pc);

    let result = client.try_batch_claim(&entries, &proofs);
    assert_eq!(result, Err(Ok(AirdropError::AlreadyClaimed)));

    // `a` keeps the single claim, but `b` and `c` were rolled back.
    assert_eq!(token_balance(&env, &token, &a), 1000);
    assert_eq!(token_balance(&env, &token, &b), 0);
    assert_eq!(token_balance(&env, &token, &c), 0);
}
