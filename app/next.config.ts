import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/spl-token"],
};

export default nextConfig;
