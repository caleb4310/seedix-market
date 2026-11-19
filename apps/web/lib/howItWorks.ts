/** Homepage steps. Numbers match SeedixConstants and the README fee table. */
export const howItWorks = [
  {
    title: "Launch a coin",
    body: "Pick a name, a ticker, a backing token, a fee mode, and a starting cap. One transaction. No code.",
  },
  {
    title: "Trade the pool",
    body: "The coin trades on a Uniswap v4 pool with the Seedix hook. A swap in the launch transaction itself reverts.",
  },
  {
    title: "The first 10 seconds",
    body: "The hook fee starts at 80% and falls to 1% over 10 seconds. After that it stays at 1%.",
  },
  {
    title: "Fees and kickbacks",
    body: "The platform fee is 1%, split in half between the burn pot and the fee wallet. The LP fee is 0.1% and goes to the creator. On a Kickback coin, holders are paid their share of the backing token.",
  },
  {
    title: "Graduation",
    body: "Graduation locks the coin in one home-chain adapter so the same supply can move to another chain.",
  },
] as const;
