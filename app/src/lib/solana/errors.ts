export function formatSolanaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("User rejected")) {
    return "Transaction was rejected in Phantom.";
  }

  if (message.includes("Wallet is not whitelisted")) {
    return "Wallet is not whitelisted for this asset yet.";
  }

  if (message.includes("Insufficient reserve")) {
    return "The asset reserve is too low for this payout.";
  }

  if (
    message.includes(
      "Attempt to debit an account but found no record of a prior credit"
    )
  ) {
    return "The localnet admin wallet is not funded or the asset has not been seeded yet.";
  }

  if (message.includes("Failed to fetch")) {
    return "Localnet RPC is not reachable. Start the validator and try again.";
  }

  return message.replace(/^Error:\s*/, "");
}
