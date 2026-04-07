import { notFound, redirect } from "next/navigation";
import { getDemoAssetPackage } from "@/lib/server/demo-asset";

export default async function AssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const assetPackage = await getDemoAssetPackage();

  if (assetId !== String(assetPackage.config.assetId)) {
    notFound();
  }

  redirect("/");
}
