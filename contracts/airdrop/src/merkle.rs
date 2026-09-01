//! Merkle proof verification.
//!
//! Uses SHA-256 (available natively in the Soroban host environment) to
//! verify inclusion proofs against a stored root hash.
//!
//! # Leaf construction
//!
//! A leaf is the SHA-256 hash of a pre-hashed address concatenated with the
//! 16-byte big-endian encoding of the amount:
//!
//!   `SHA-256( SHA-256(address_strkey_utf8_bytes) ++ amount_be_bytes[16] )`
//!
//! The address is first encoded as its Stellar strkey string (e.g. `G...` for
//! accounts, `C...` for contracts), then the UTF-8 bytes of that string are
//! SHA-256 hashed to produce a fixed 32-byte value. This hash is then
//! concatenated with the 16-byte big-endian i128 amount and SHA-256 hashed
//! again to produce the leaf.
//!
//! The TypeScript SDK's `leafHash()` must match this exactly:
//!   - Hash the strkey string bytes with SHA-256 (do NOT use raw decoded bytes).
//!   - Encode the amount as 16-byte big-endian (i128 → two 64-bit words).
//!   - SHA-256 the concatenation.
//!
//! # Node hashing
//!
//! Interior nodes are hashed with the two child hashes sorted
//! lexicographically before hashing, so the tree is position-independent:
//!   `node = SHA-256(min(left, right) ++ max(left, right))`
//!
//! This matches the convention used by the TypeScript SDK's MerkleTree builder.

use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

/// Compute the leaf hash for a (claimant, amount) pair.
///
/// Leaf = `SHA-256( SHA-256(address_strkey_utf8_bytes) ++ amount_be_bytes[16] )`
///
/// The address is hashed as its strkey UTF-8 string bytes (e.g. `G...` or
/// `C...`), not as raw decoded bytes. The TypeScript SDK must match this.
pub fn leaf_hash(env: &Env, claimant: &Address, amount: i128) -> BytesN<32> {
    // Step 1: SHA-256 the strkey UTF-8 bytes of the address.
    let addr_str: soroban_sdk::String = claimant.to_string();
    let addr_str_bytes: Bytes = addr_str.to_bytes();
    let addr_hash: BytesN<32> = env.crypto().sha256(&addr_str_bytes).into();

    // Step 2: Concatenate addr_hash (32 bytes) with amount (16-byte big-endian i128).
    let mut data = Bytes::new(env);
    data.append(&addr_hash.into());

    let amount_b: Bytes = Bytes::from_array(env, &amount.to_be_bytes());
    data.append(&amount_b);

    // Step 3: SHA-256 the concatenation to get the leaf.
    env.crypto().sha256(&data).into()
}

/// Verify a Merkle proof.
///
/// Returns `true` if `proof` is a valid inclusion proof that `leaf_hash`
/// is a member of the tree with root `root`.
///
/// `proof` is an ordered list of sibling hashes from leaf to root.
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
