import { ContractFunctionRevertedError } from "viem";

/** Name or raw selector from a viem revert. The first line of the message drops the reason. */
export function revertLabel(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ContractFunctionRevertedError) {
      const name = current.data?.errorName || current.reason;
      if (name) return name;
    }
    const named = (current as { data?: { errorName?: string }; errorName?: string }).data?.errorName
      ?? (current as { errorName?: string }).errorName;
    if (named) return named;
    current = (current as { cause?: unknown }).cause;
  }
  const message = err instanceof Error ? err.message : "transaction failed";
  const lines = message.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const index = lines.findIndex((line) => /reverted with the following (reason|signature):?$/i.test(line));
  if (index >= 0 && lines[index + 1]) return lines[index + 1];
  return lines[0] ?? "transaction failed";
}
