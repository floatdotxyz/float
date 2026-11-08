//! Merkle proofs for trader airdrops.
//!
//! ```text
//! leaf = H(0x00 ‖ round_id:u64le ‖ index:u64le ‖ wallet:[u8;32] ‖ amount:u64le)
//! node = H(0x01 ‖ min(a, b) ‖ max(a, b))          (sorted pair → order-free proofs)
//! ```
//!
//! Domain-separating leaves (`0x00`) from nodes (`0x01`) prevents
//! second-preimage attacks where an inner node is presented as a leaf.
//! `H` is SHA-256: `solana_program::hash::hashv` on chain, `node:crypto` in
//! the TypeScript builder (`packages/sdk/src/float/merkle.ts`).

/// A 32-byte hash.
pub type Hash = [u8; 32];

/// Hashing backend: SHA-256 over the concatenation of `parts`.
pub trait Hasher {
    /// Hashes the concatenation of `parts`.
    fn hashv(parts: &[&[u8]]) -> Hash;
}

/// Leaf hash for an airdrop allocation.
pub fn leaf<H: Hasher>(round_id: u64, index: u64, wallet: &[u8; 32], amount: u64) -> Hash {
    H::hashv(&[&[0x00], &round_id.to_le_bytes(), &index.to_le_bytes(), wallet, &amount.to_le_bytes()])
}

/// Parent of two nodes (sorted).
pub fn node<H: Hasher>(a: &Hash, b: &Hash) -> Hash {
    if a <= b {
        H::hashv(&[&[0x01], a, b])
    } else {
        H::hashv(&[&[0x01], b, a])
    }
}

/// Verifies `proof` for `leaf` against `root`.
pub fn verify<H: Hasher>(proof: &[Hash], root: &Hash, leaf: Hash) -> bool {
    let mut acc = leaf;
    for p in proof {
        acc = node::<H>(&acc, p);
    }
    &acc == root
}

#[cfg(test)]
pub(crate) mod sha256 {
    //! Minimal FIPS 180-4 SHA-256, test-only.
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
        0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
        0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
        0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
        0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    pub fn digest(data: &[u8]) -> [u8; 32] {
        let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        let mut msg = data.to_vec();
        let bit_len = (data.len() as u64) * 8;
        msg.push(0x80);
        while msg.len() % 64 != 56 {
            msg.push(0);
        }
        msg.extend_from_slice(&bit_len.to_be_bytes());
        for chunk in msg.chunks(64) {
            let mut w = [0u32; 64];
            for i in 0..16 {
                w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
            }
            for i in 16..64 {
                let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
                let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
            }
            let mut v = h;
            for i in 0..64 {
                let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
                let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
                let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
                let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
                let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
                let t2 = s0.wrapping_add(maj);
                v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
            }
            for i in 0..8 {
                h[i] = h[i].wrapping_add(v[i]);
            }
        }
        let mut out = [0u8; 32];
        for i in 0..8 {
            out[4 * i..4 * i + 4].copy_from_slice(&h[i].to_be_bytes());
        }
        out
    }

    pub struct Sha256;
    impl super::Hasher for Sha256 {
        fn hashv(parts: &[&[u8]]) -> [u8; 32] {
            digest(&parts.concat())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::sha256::{digest, Sha256};
    use super::*;

    fn hex(s: &str) -> Hash {
        let mut o = [0u8; 32];
        for i in 0..32 {
            o[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        o
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(digest(b""), hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
        assert_eq!(digest(b"abc"), hex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    }

    #[test]
    fn four_leaf_tree() {
        let w = |b: u8| [b; 32];
        let l: Vec<Hash> = (0..4u64).map(|i| leaf::<Sha256>(2, i, &w(i as u8 + 1), 1_000 * (i + 1))).collect();
        let n01 = node::<Sha256>(&l[0], &l[1]);
        let n23 = node::<Sha256>(&l[2], &l[3]);
        let root = node::<Sha256>(&n01, &n23);
        assert!(verify::<Sha256>(&[l[1], n23], &root, l[0]));
        assert!(verify::<Sha256>(&[l[2], n01], &root, l[3]));
        // wrong amount
        assert!(!verify::<Sha256>(&[l[1], n23], &root, leaf::<Sha256>(2, 0, &w(1), 999)));
        // wrong round
        assert!(!verify::<Sha256>(&[l[1], n23], &root, leaf::<Sha256>(3, 0, &w(1), 1_000)));
    }

    /// Cross-language fixture produced by `packages/sdk/src/float/merkle.ts`
    /// (see `packages/sdk/test/merkle.test.ts`, which writes the same values).
    #[test]
    fn typescript_fixture() {
        let fx = include_str!("../tests/fixtures/airdrop-merkle.json");
        let root = extract(fx, "\"root\": \"");
        let leaf0 = extract(fx, "\"leaf0\": \"");
        let proof0: Vec<Hash> = extract_list(fx, "\"proof0\": [");
        let wallet0 = extract(fx, "\"wallet0\": \"");
        let amount0: u64 = extract_num(fx, "\"amount0\": ");
        let round: u64 = extract_num(fx, "\"roundId\": ");
        assert_eq!(leaf::<Sha256>(round, 0, &wallet0, amount0), leaf0);
        assert!(verify::<Sha256>(&proof0, &root, leaf0));
    }

    fn extract(s: &str, key: &str) -> Hash {
        let i = s.find(key).unwrap() + key.len();
        hex(&s[i..i + 64])
    }
    fn extract_num(s: &str, key: &str) -> u64 {
        let i = s.find(key).unwrap() + key.len();
        s[i..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap()
    }
    fn extract_list(s: &str, key: &str) -> Vec<Hash> {
        let i = s.find(key).unwrap() + key.len();
        let end = s[i..].find(']').unwrap();
        s[i..i + end].split('"').filter(|x| x.len() == 64).map(hex).collect()
    }
}
