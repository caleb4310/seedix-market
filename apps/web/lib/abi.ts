import type { Abi } from "viem";
import erc20 from "./abi/erc20.json" with { type: "json" };
import hook from "./abi/hook.json" with { type: "json" };
import kickback from "./abi/kickback.json" with { type: "json" };
import launcher from "./abi/launcher.json" with { type: "json" };
import launcherLegacy from "./abi/launcher-legacy.json" with { type: "json" };
import metadata from "./abi/metadata.json" with { type: "json" };
import quoter from "./abi/quoter.json" with { type: "json" };
import router from "./abi/router.json" with { type: "json" };
import weth from "./abi/weth.json" with { type: "json" };

/** ABIs taken from the contract sources. Addresses stay in deployments/99801.json. */
export const erc20Abi = erc20 as Abi;
export const wethAbi = weth as Abi;
export const launcherAbi = launcher as Abi;
export const launcherLegacyAbi = launcherLegacy as Abi;
export const metadataAbi = metadata as Abi;
export const routerAbi = router as Abi;
/** Router errors plus hook, pool, and ERC-20 errors that bubble out of `swap`. */
export const swapAbi = [
  ...router,
  { type: "error", name: "Locked", inputs: [] },
  { type: "error", name: "SwapDuringLaunch", inputs: [] },
  { type: "error", name: "UnknownPool", inputs: [] },
  { type: "error", name: "Overflow", inputs: [] },
  { type: "error", name: "SafeCastOverflow", inputs: [] },
  {
    type: "error",
    name: "PriceLimitAlreadyExceeded",
    inputs: [
      { name: "sqrtPriceCurrentX96", type: "uint160" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  },
  { type: "error", name: "PriceLimitOutOfBounds", inputs: [{ name: "sqrtPriceLimitX96", type: "uint160" }] },
  { type: "error", name: "NotEnoughLiquidity", inputs: [{ name: "poolId", type: "bytes32" }] },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as Abi;
export const quoterAbi = quoter as Abi;
export const kickbackAbi = kickback as Abi;
export const hookConfigAbi = hook as Abi;
export const tokenMetaAbi = erc20Abi;
export const decimalsAbi = erc20Abi;

export const actionAbis: Abi = [
  ...erc20,
  ...weth,
  ...launcher,
  ...router,
  ...kickback,
] as Abi;
