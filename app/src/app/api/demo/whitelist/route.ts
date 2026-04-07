import { NextResponse } from "next/server";
import type { Idl } from "@coral-xyz/anchor";
import { createConnection } from "@/lib/solana/rwa-client";
import { DEFAULT_ASSET_ID, IS_LOCALNET, SOLANA_RPC_URL } from "@/lib/solana/env";
import { addWalletToWhitelist, getDemoAssetPackage } from "@/lib/server/demo-asset";
import { formatSolanaError } from "@/lib/solana/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!IS_LOCALNET) {
    return NextResponse.json(
      {
        error: "Demo whitelist is only available on localnet.",
      },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as {
      wallet?: string;
      assetId?: number;
    };

    if (!body.wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }

    const assetPackage = await getDemoAssetPackage();
    const result = await addWalletToWhitelist({
      connection: createConnection(SOLANA_RPC_URL),
      idl: assetPackage.rwaIdl as Idl,
      assetId: body.assetId ?? DEFAULT_ASSET_ID,
      walletAddress: body.wallet,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: formatSolanaError(error),
      },
      { status: 500 }
    );
  }
}
