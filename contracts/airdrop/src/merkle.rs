//! Merkle proof verification.
//!
//! Uses SHA-256 (available natively in the Soroban host environment) to
//! verify inclusion proofs against a stored root hash.
//!
//! # Leaf construction
//!
//! A leaf is the SHA-256 hash of a pre-hashed contract address (domain
//! separator), a pre-hashed claimant address, and the 16-byte big-endian
//! encoding of the amount:
//!
//!   `SHA-256( SHA-256(contract_strkey_utf8_bytes) ++ SHA-256(claimant_strkey_utf8_bytes) ++ amount_be_bytes[16] )`
//!
//! The contract address is hashed first so that a proof valid on one
//! deployment is not valid on a second deployment that shares the same root
//! (cross-contract replay / same-root attack — see docs/replay-attack-analysis.md).
//!
//! Both the contract and the claimant are encoded as their Stellar strkey
//! strings (e.g. `C...` / `G...`), then SHA-256 hashed.  That result is then
//! concatenated with the 16-byte big-endian i128 amount and SHA-256'd again.
//!
//! The TypeScript SDK's `leafHash()` must match this exactly:
//!   - Hash the contract strkey string bytes with SHA-256 first.
//!   - Hash the claimant strkey string bytes with SHA-256 second.
//!   - Encode the amount as 16-byte big-endian (i128 → two 64-bit words).
//!   - SHA-256 the concatenation of the three values above.
//!
//! # Node hashing
//!
//! Interior nodes are hashed with the two child hashes sorted
//! lexicographically before hashing, so the tree is position-independent:
//!   `node = SHA-256(min(left, right) ++ max(left, right))`
//!
//! This matches the convention used by the TypeScript SDK's MerkleTree builder.

use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

/// Compute the leaf hash for a (claimant, amount) pair, bound to this contract.
///
/// Leaf = `SHA-256( SHA-256(contract_strkey_utf8_bytes) ++ SHA-256(address_strkey_utf8_bytes) ++ amount_be_bytes[16] )`
///
/// The contract address is included as the first component so that a valid
/// proof on one deployment cannot be replayed against a second deployment
/// that shares the same Merkle root (domain separation).
///
/// The address is hashed as its strkey UTF-8 string bytes (e.g. `G...` or
/// `C...`), not as raw decoded bytes. The TypeScript SDK must match this.
pub fn leaf_hash(env: &Env, contract_id: &Address, claimant: &Address, amount: i128) -> BytesN<32> {
    // Step 1: SHA-256 the strkey UTF-8 bytes of the *contract* address (domain separator).
    let contract_str: soroban_sdk::String = contract_id.to_string();
    let contract_str_bytes: Bytes = contract_str.to_bytes();
    let contract_hash: BytesN<32> = env.crypto().sha256(&contract_str_bytes).into();

    // Step 2: SHA-256 the strkey UTF-8 bytes of the claimant address.
    let addr_str: soroban_sdk::String = claimant.to_string();
    let addr_str_bytes: Bytes = addr_str.to_bytes();
    let addr_hash: BytesN<32> = env.crypto().sha256(&addr_str_bytes).into();

    // Step 3: Concatenate contract_hash (32 bytes) ++ addr_hash (32 bytes) ++ amount (16-byte big-endian i128).
    let mut data = Bytes::new(env);
    data.append(&contract_hash.into());
    data.append(&addr_hash.into());

    let amount_b: Bytes = Bytes::from_array(env, &amount.to_be_bytes());
    data.append(&amount_b);

    // Step 4: SHA-256 the concatenation to get the leaf.
    env.crypto().sha256(&data).into()
}

/// Verify a Merkle proof.
///
/// Returns `true` if `proof` is a valid inclusion proof that `leaf_hash`
/// is a member of the tree with root `root`.
///
/// `proof` is an ordered list of sibling hashes from leaf to root.
///
/// # Examples
///
/// ```
/// use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};
/// use soroban_merkle_airdrop::merkle::{leaf_hash, verify_proof};
///
/// let env = Env::default();
///
/// let alice = Address::from_str(
///     &env,
///     "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
/// );
/// let bob = Address::from_str(
///     &env,
///     "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
/// );
///
/// // Build a two-leaf tree: root = hash_pair(leaf_alice, leaf_bob).
/// let leaf_alice = leaf_hash(&env, &alice, 1_000);
/// let leaf_bob   = leaf_hash(&env, &bob, 500);
///
/// // Sort and hash the two leaves to get the root (mirrors the contract's hash_pair logic).
/// let root: BytesN<32> = {
///     let mut data = Bytes::new(&env);
///     let (first, second) = if leaf_alice.as_ref() <= leaf_bob.as_ref() {
///         (leaf_alice.clone(), leaf_bob.clone())
///     } else {
///         (leaf_bob.clone(), leaf_alice.clone())
///     };
///     data.append(&first.into());
///     data.append(&second.into());
///     env.crypto().sha256(&data).into()
/// };
///
/// // Alice's proof is just Bob's leaf hash (her sibling in the two-leaf tree).
/// let mut proof_alice: Vec<BytesN<32>> = Vec::new(&env);
/// proof_alice.push_back(leaf_bob.clone());
///
/// assert!(verify_proof(&env, &root, leaf_alice.clone(), &proof_alice));
///
/// // A tampered proof (empty) must not verify against the same root.
/// let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
/// assert!(!verify_proof(&env, &root, leaf_alice, &empty_proof));
/// ```
pub fn verify_proof(
    env: &Env,
    root: &BytesN<32>,
    leaf: BytesN<32>,
    proof: &Vec<BytesN<32>>,
) -> bool {
    let mut current = leaf;

    for sibling in proof.iter() {
        current = hash_pair(env, current, sibling);
    }

    &current == root
}

/// Hash two nodes together, sorting them first so the tree is order-independent.
fn hash_pair(env: &Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::new(env);

    // Sort lexicographically: smaller hash goes first.
    let (first, second) = if a.as_ref() <= b.as_ref() {
        (a, b)
    } else {
        (b, a)
    };

    data.append(&first.into());
    data.append(&second.into());

    env.crypto().sha256(&data).into()
}
