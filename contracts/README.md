# Contracts

Foundry project for the Seedix hook, launcher, and fee pots. See the repository README for the fee model, pins, and the Anvil dry-run.

```bash
forge test
forge fmt --check
```

`script/Deploy.s.sol` deploys the testnet stack. It reverts unless the chain id is 99801 or 31337.
