//! Merkle proof verification.
//!
//! Uses SHA-256 (available natively in the Soroban host environment) to
//! verify inclusion proofs against a stored root hash.
//!
//! # Leaf construction
//!
//! A leaf is the SHA-256 hash of:
//!   `address_bytes (32 bytes) ++ amount (16 bytes, big-endian i128)`
//!
//! # Node hashing
//!
//! Interior nodes are hashed with the two child hashes sorted
//! lexicographically before hashing, so the tree is position-independent:
//!   `node = SHA-256(min(left, right) ++ max(left, right))`
//!
//! This matches the convention used by the TypeScript SDK's MerkleTree builder.

use soroban_sdk::{Address, Bytes, BytesN, Env};

/// Compute the leaf hash for a (claimant, amount) pair.
pub fn leaf_hash(env: &Env, claimant: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);

    // Encode the address as its raw 32-byte Stellar strkey binary.
    let addr_bytes: BytesN<32> = claimant.clone().try_into().unwrap_or_else(|_| {
        // Contract addresses are also 32 bytes via the ScAddress representation.
        // We serialize via the XDR encoding of the address sc-val.
        let raw = env.crypto().sha256(&claimant.to_string().as_bytes());
        raw
    });
    data.append(&addr_bytes.into());

    // Encode amount as 16-byte big-endian i128.
    let amount_bytes = amount.to_be_bytes();
    let amount_b: Bytes = Bytes::from_array(env, &amount_bytes);
    data.append(&amount_b);

    env.crypto().sha256(&data)
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
    proof: &[BytesN<32>],
) -> bool {
    let mut current = leaf;

    for sibling in proof.iter() {
        current = hash_pair(env, current, sibling.clone());
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

    env.crypto().sha256(&data)
}
