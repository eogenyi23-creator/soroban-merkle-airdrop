/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@soroban-merkle-airdrop/sdk"],
  env: {
    NEXT_PUBLIC_AIRDROP_CONTRACT_ID: process.env.AIRDROP_CONTRACT_ID ?? "",
    NEXT_PUBLIC_NETWORK: process.env.NETWORK ?? "testnet",
  },
};
module.exports = nextConfig;
