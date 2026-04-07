export type DemoAssetConfig = {
  assetId: number;
  assetName: string;
  shareSymbol: string;
  assetUri: string;
  metadataPath?: string;
  documentPath: string;
  totalShares: number;
  yieldRatePerDay: number;
  reserveTopUpLamports: number;
  initialWhitelist: string[];
};

export type DemoAssetMetadata = {
  name: string;
  symbol: string;
  description: string;
  external_url: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
  properties: {
    display_name: string;
    address: string;
    issuer: string;
    document_manifest_url: string;
    document_manifest_sha256: string;
    asset_id: number;
    compliance_model: string;
    projected_annual_yield_percent: number;
    hero_image?: string;
    proof_image?: string;
    gallery_images?: string[];
  };
};

export type DemoManifest = {
  assetName: string;
  jurisdiction: string;
  structure: string;
  verificationChecklist: string[];
  bundleVersion: number;
  notes: string;
};

export type DemoAssetPackage = {
  config: DemoAssetConfig;
  metadata: DemoAssetMetadata;
  manifest: DemoManifest;
  documentHash: string;
  rwaIdl: Record<string, unknown>;
  hookProgramId: string;
};
