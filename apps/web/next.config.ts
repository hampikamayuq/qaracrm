import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@qara/shared"],
  // @qara/shared usa especificadores NodeNext ('./x.js' apontando pra fonte
  // .ts) porque o apps/api também o consome; ensina o webpack a resolvê-los.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};

export default nextConfig;