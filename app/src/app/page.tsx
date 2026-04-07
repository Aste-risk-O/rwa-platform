import type { Idl } from "@coral-xyz/anchor";
import { AssetDetailClient } from "@/components/asset-detail-client";
import { getDemoAssetPackage } from "@/lib/server/demo-asset";

export default async function Home() {
  const assetPackage = await getDemoAssetPackage();

  return (
    <AssetDetailClient
      assetPackage={assetPackage}
      rwaIdl={assetPackage.rwaIdl as Idl}
    />
  );
}
