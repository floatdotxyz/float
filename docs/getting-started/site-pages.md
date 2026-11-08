# Site pages

| Page | URL | What it's for |
| --- | --- | --- |
| Home | <https://www.floatlaunch.xyz/> | Landing page |
| Create | <https://www.floatlaunch.xyz/create> | Launch a coin: ticker, metadata, paired token, creator wallet |
| Tokens | <https://www.floatlaunch.xyz/tokens> | Browse Float coins |
| Analytics | <https://www.floatlaunch.xyz/analytics> | Platform stats and the **trader leaderboard** used for airdrops |
| Profile | <https://www.floatlaunch.xyz/profile> | Your rewards, token accounts and wallet tools |
| Burns | <https://www.floatlaunch.xyz/burns> | Every $FLOAT buyback and burn |
| Docs | <https://www.floatlaunch.xyz/docs> | Official documentation |

## Coin page

Each coin's page has a **Cycle fees** button. Pressing it moves the coin's pending
fees out of Raydium's vaults and through the split. Anyone can press it. See
[Fee cycling](../mechanics/fee-cycling.md).

## Profile tools

Holder payouts arrive in many different paired tokens. The Profile page helps
you manage them:

- **Swap to SOL.** Swap the listed tokens you've received to SOL through
  Jupiter, **up to 4 tokens per wallet approval**.
- **Unwrap wSOL.** Payouts in SOL arrive as wrapped SOL. Unwrap it to native SOL.
- **Keep token accounts open.** Closing a token account returns its rent, but
  the next payout in that token then needs a new account. The payout bot only
  creates one once you're owed at least $2, so smaller payouts roll over until
  then. Keeping accounts open means every payout lands right away.

## Stats are best-effort

Site prices and stats can be delayed or wrong. For anything that matters, use
on-chain data. The [CLI](../developers/cli.md) and
[Auditing](../developers/auditing.md) pages show how.
