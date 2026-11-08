# Security

## This repository

If you find a bug in the SDK or CLI that could cause a user to sign a harmful
transaction (wrong accounts, wrong amounts, missing slippage protection),
please **do not open a public issue**. Report it privately through GitHub's
"Report a vulnerability" (Security → Advisories) on this repository.

Every transaction-building path in the CLI **simulates by default** and needs
`--send` to broadcast. Keep it that way.

## Float and Raydium

This is an unofficial project. Vulnerabilities in the **Float program** should
go to the Float team through their official channels. Vulnerabilities in
**Raydium** programs should go to Raydium's bug bounty.

## Keys

Never commit keypair files. `.gitignore` excludes common names, but check
before you push.
