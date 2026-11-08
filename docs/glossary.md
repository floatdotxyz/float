# Glossary

| Term | Meaning |
| --- | --- |
| **ATA** | Associated token account: the canonical token account for a wallet + mint, derived from both. |
| **Bonding curve** | The LaunchLab pricing curve a coin trades on before graduation. |
| **bps** | Basis points; 100 bps = 1%. |
| **Burn & Earn** | Raydium program that locks CPMM liquidity permanently while letting a position-NFT holder claim the trading fees it earns. |
| **Creator wallet** | The wallet chosen at launch to receive the creator's 5%. |
| **CPMM** | Raydium's constant-product AMM. Graduated coins trade here. |
| **Cycle fees** | Claiming a coin's pending fees from Raydium's vaults and routing them through the split. Anyone can trigger it; the payout bot does it automatically. |
| **Fee tier** | A LaunchLab platform configuration with its own fee rates. Float has its own. |
| **Flagship** | $FLOAT, and the 35% share that buys and burns it. |
| **Graduation** | When the curve sells out and LaunchLab migrates the coin to a CPMM pool. |
| **LaunchLab** | Raydium's launchpad program (`raydium_launchpad`). |
| **Paired token** | The quote token a coin trades against. Holders and the creator are paid in it. |
| **Payout bot** | Float's bot that cycles fees and pays holders every few minutes. |
| **PDA** | Program-derived address: an address derived from seeds and a program id, with no private key. |
| **Platform fee** | The part of LaunchLab's trading fee that goes to the platform (Float). It is what Float splits. |
| **Price guard** | Minimum output on cycle swaps; limits front-running to about 2% of a swap. |
| **Rolls over** | Owed holder rewards carried to later payouts, e.g. under the $2 account-creation threshold. |
| **Ticker reuse fee** | 1 SOL to launch an already launched ticker, refunded on graduation within 48 h. |
| **Token-2022** | Solana's extended token program; supports transfer fees and other extensions. |
| **Treasury** | The platform wallet receiving 10% of fees and ticker reuse fees. |
| **wSOL** | Wrapped SOL, the SPL-token form of SOL. |
