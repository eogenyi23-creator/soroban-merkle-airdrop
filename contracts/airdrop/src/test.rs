#![cfg(test)]

extern crate alloc;

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
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
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
    let (first, second) = if a.as_ref() <= b.as_ref() {
        (a, b)
    } else {
        (b, a)
    };
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
    assert!(
        pause_event.is_some(),
        "set_active(false) must emit a 'paused' event with data=false"
    );

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

    // Verify the "paused" event was emitted for the unpause call.
    let events = env.events().all();
    let unpause_event = events.iter().find(|(_contract, topics, data)| {
        use soroban_sdk::IntoVal;
        *topics == (symbol_short!("paused"), admin.clone()).into_val(&env)
            && *data == true.into_val(&env)
    });
    assert!(
        unpause_event.is_some(),
        "set_active(true) must emit a 'paused' event with data=true"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "is_claimed() must refresh instance TTL; got {ttl_after}"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "is_active() must refresh instance TTL; got {ttl_after}"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "token() must refresh instance TTL; got {ttl_after}"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "admin() must refresh instance TTL; got {ttl_after}"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "total_deposited() must refresh instance TTL; got {ttl_after}"
    );
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

    let ttl_after = env.storage().instance().get_ttl();
    assert!(
        ttl_after > 1,
        "expiration() must refresh instance TTL; got {ttl_after}"
    );
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
    }
    .into()]);

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
    }
    .into()]);

    // This should panic because the stored admin's auth is not satisfied.
    client.reclaim();
}

// ─── Issue #32: Cross-language leaf-hash test vector suite ─────────────────

/// Loop over every entry in `test-vectors/leaf-hash-vectors.json` and assert
/// that `merkle::leaf_hash` in Rust produces the expected hex output.
///
/// The expected values in the JSON file were produced by running the compiled
/// TypeScript SDK (`sdk/src/merkle.ts`) with the same inputs, so a mismatch
/// here means the two implementations have diverged.
///
/// Vectors cover: G-addresses, C-addresses, amount=1, amount=i128::MAX,
/// amounts where only the high 64-bit word is set, and typical amounts.
#[test]
fn test_leaf_hash_vectors() {
    let env = Env::default();

    // The JSON file is embedded at compile time so the test is self-contained
    // and runs without filesystem access from the Soroban test harness.
    let json_bytes = include_bytes!("../../../test-vectors/leaf-hash-vectors.json");
    let json_str = core::str::from_utf8(json_bytes).expect("leaf-hash-vectors.json is not valid UTF-8");

    // Minimal JSON array parser — no external crate required.
    // Each element has the shape:
    //   { "_comment": "...", "address": "G...", "amount": "123", "expected_leaf_hex": "abc..." }
    // We extract address, amount (as string→i128), and expected_leaf_hex.
    for (i, chunk) in json_str
        .split('{')
        .skip(1) // skip the opening of the outer array
        .enumerate()
    {
        // Skip entries that don't look like data objects.
        if !chunk.contains("\"address\"") {
            continue;
        }

        let address = extract_json_str(chunk, "address")
            .unwrap_or_else(|| panic!("vector {i}: missing 'address' field"));
        let amount_str = extract_json_str(chunk, "amount")
            .unwrap_or_else(|| panic!("vector {i}: missing 'amount' field"));
        let expected_hex = extract_json_str(chunk, "expected_leaf_hex")
            .unwrap_or_else(|| panic!("vector {i}: missing 'expected_leaf_hex' field"));

        let amount: i128 = amount_str
            .parse()
            .unwrap_or_else(|_| panic!("vector {i}: cannot parse amount '{amount_str}'"));

        let addr = Address::from_str(&env, address);
        let actual = merkle::leaf_hash(&env, &addr, amount);

        let expected_bytes = hex_decode(expected_hex)
            .unwrap_or_else(|| panic!("vector {i}: invalid hex in expected_leaf_hex"));
        let expected: BytesN<32> = BytesN::from_array(
            &env,
            expected_bytes
                .as_slice()
                .try_into()
                .unwrap_or_else(|_| panic!("vector {i}: expected_leaf_hex must be 32 bytes")),
        );

        assert_eq!(
            actual, expected,
            "vector {i} ({address}, {amount_str}): Rust leaf_hash does not match TypeScript SDK output"
        );
    }
}

/// Extract the string value for a JSON key from a raw chunk of JSON text.
/// Handles the form `"key": "value"` (double-quoted string values only).
fn extract_json_str<'a>(chunk: &'a str, key: &str) -> Option<&'a str> {
    let needle = alloc::format!("\"{}\":", key);
    let start = chunk.find(needle.as_str())?;
    let rest = &chunk[start + needle.len()..];
    // Skip whitespace.
    let rest = rest.trim_start_matches([' ', '\t', '\n', '\r']);
    if !rest.starts_with('"') {
        return None;
    }
    let inner = &rest[1..]; // skip opening quote
    let end = inner.find('"')?;
    Some(&inner[..end])
}

/// Decode a lowercase hex string into bytes. Returns None on invalid input.
fn hex_decode(hex: &str) -> Option<alloc::vec::Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut out = alloc::vec::Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    for chunk in bytes.chunks(2) {
        let hi = hex_nibble(chunk[0])?;
        let lo = hex_nibble(chunk[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
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
    let expected = BytesN::from_array(
        &env,
        &[
            0x7c, 0x71, 0x75, 0xb9, 0x51, 0xbe, 0x4c, 0x0b, 0xc4, 0x23, 0x31, 0x70, 0x88, 0x40,
            0xf3, 0x97, 0xc1, 0x48, 0x78, 0x8c, 0x89, 0x11, 0xa7, 0xcf, 0x1b, 0x06, 0x22, 0xf2,
            0x88, 0xb3, 0xa6, 0xce,
        ],
    );

    let actual = merkle::leaf_hash(&env, &address, amount);
    assert_eq!(
        actual, expected,
        "Rust leaf_hash does not match TypeScript SDK output — the two implementations disagree"
    );
}

// ─── Issue #23: transfer_admin ─────────────────────────────────────────────

/// Successful admin transfer: admin() reflects new owner and the event is emitted.
#[test]
fn test_transfer_admin_success() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    client.transfer_admin(&new_admin);

    // admin() must now return the new admin.
    assert_eq!(client.admin(), Some(new_admin.clone()));

    // Verify event ("adm_xfer", old_admin) → new_admin was emitted.
    let events = env.events().all();
    let xfer_event = events.iter().find(|(_contract, topics, data)| {
        use soroban_sdk::IntoVal;
        *topics == (symbol_short!("adm_xfer"), admin.clone()).into_val(&env)
            && *data == new_admin.clone().into_val(&env)
    });
    assert!(xfer_event.is_some(), "transfer_admin must emit ('adm_xfer', old_admin) → new_admin");
}

/// Non-admin calling transfer_admin must panic (auth failure).
#[test]
#[should_panic]
fn test_non_admin_transfer_admin_fails() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    // Authorize non_admin instead of the real admin — must panic.
    env.set_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "transfer_admin",
            args: (new_admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }.into()]);

    client.transfer_admin(&new_admin);
}

/// After a transfer, the new admin can call set_active; the old admin cannot.
#[test]
fn test_new_admin_can_set_active() {
    let (env, admin, token, contract_id) = setup();
    let client = AirdropContractClient::new(&env, &contract_id);
    let claimant = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let (root, _, _) = build_two_leaf_tree(&env, &claimant, 1000, &admin, 500);
    mint(&env, &token, &admin, &admin, 1500);
    client.initialize(&admin, &token, &root, &1500, &DEFAULT_EXPIRATION);

    client.transfer_admin(&new_admin);

    // New admin pauses the airdrop — must succeed.
    client.set_active(&false);
    assert!(!client.is_active());
}

/// transfer_admin on an uninitialised contract returns NotInitialized.
#[test]
fn test_transfer_admin_uninitialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AirdropContract, ());
    let client = AirdropContractClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);

    let result = client.try_transfer_admin(&new_admin);
    assert_eq!(result, Err(Ok(AirdropError::NotInitialized)));
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
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
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

// ─── Issue #64: verify_proof edge case unit tests ────────────────────────────

/// An empty proof against a root that equals the leaf returns true.
/// This is the single-node-tree case: the leaf IS the root.
#[test]
fn test_verify_proof_empty_proof_leaf_equals_root_returns_true() {
    let env = Env::default();
    let addr = Address::generate(&env);
    let amount: i128 = 500;

    let leaf = merkle::leaf_hash(&env, &addr, amount);

    // With an empty proof the computed hash stays at the leaf — so it must
    // equal the root only when root == leaf.
    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
    assert!(
        merkle::verify_proof(&env, &leaf, leaf.clone(), &empty_proof),
        "empty proof against root==leaf must return true (single-node tree)"
    );
}

/// An empty proof against a root that differs from the leaf returns false.
#[test]
fn test_verify_proof_empty_proof_leaf_not_equal_root_returns_false() {
    let env = Env::default();
    let addr = Address::generate(&env);
    let amount: i128 = 500;

    let leaf = merkle::leaf_hash(&env, &addr, amount);

    // Manufacture a root that is different from the leaf.
    let other_addr = Address::generate(&env);
    let wrong_root = merkle::leaf_hash(&env, &other_addr, amount);

    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
    assert!(
        !merkle::verify_proof(&env, &wrong_root, leaf, &empty_proof),
        "empty proof against root!=leaf must return false"
    );
}

/// A valid one-element proof (two-leaf tree) returns true.
#[test]
fn test_verify_proof_length_one_two_leaf_tree_returns_true() {
    let env = Env::default();
    let addr0 = Address::generate(&env);
    let addr1 = Address::generate(&env);

    let (root, proof0, proof1) = build_two_leaf_tree(&env, &addr0, 1000, &addr1, 500);

    assert!(
        merkle::verify_proof(&env, &root, merkle::leaf_hash(&env, &addr0, 1000), &proof0),
        "valid proof for leaf0 in a two-leaf tree must return true"
    );
    assert!(
        merkle::verify_proof(&env, &root, merkle::leaf_hash(&env, &addr1, 500), &proof1),
        "valid proof for leaf1 in a two-leaf tree must return true"
    );
}

/// A proof that is one element too long (extra hash appended) returns false.
#[test]
fn test_verify_proof_one_element_too_long_returns_false() {
    let env = Env::default();
    let addr0 = Address::generate(&env);
    let addr1 = Address::generate(&env);

    let (root, mut proof0, _) = build_two_leaf_tree(&env, &addr0, 1000, &addr1, 500);

    // Sanity check: the original proof is valid.
    assert!(
        merkle::verify_proof(&env, &root, merkle::leaf_hash(&env, &addr0, 1000), &proof0),
        "sanity: correct proof must be valid"
    );

    // Append a random extra hash — any hash that doesn't legitimately belong.
    let extra = merkle::leaf_hash(&env, &Address::generate(&env), 1);
    proof0.push_back(extra);

    assert!(
        !merkle::verify_proof(&env, &root, merkle::leaf_hash(&env, &addr0, 1000), &proof0),
        "proof with one extra element must return false"
    );
}

/// A proof consisting of all-same hashes returns false (unless the tree
/// genuinely has that structure, which is astronomically unlikely for distinct
/// inputs).
#[test]
fn test_verify_proof_all_same_hash_returns_false() {
    let env = Env::default();
    let addr = Address::generate(&env);
    let amount: i128 = 1000;

    let leaf = merkle::leaf_hash(&env, &addr, amount);

    // Build a proof of three identical hashes (the leaf itself, repeated).
    // These do NOT correspond to any legitimate tree whose root we would store.
    let mut bogus_proof: Vec<BytesN<32>> = Vec::new(&env);
    bogus_proof.push_back(leaf.clone());
    bogus_proof.push_back(leaf.clone());
    bogus_proof.push_back(leaf.clone());

    // Compute what the verifier would produce for this proof so we can confirm
    // it does NOT equal a legitimately constructed root.
    let addr0 = Address::generate(&env);
    let addr1 = Address::generate(&env);
    let (legitimate_root, _, _) = build_two_leaf_tree(&env, &addr0, 500, &addr1, 500);

    assert!(
        !merkle::verify_proof(&env, &legitimate_root, leaf.clone(), &bogus_proof),
        "all-same-hash proof against a real root must return false"
    );
}
