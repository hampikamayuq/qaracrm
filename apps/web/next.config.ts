import type { NextConfig } from "next";

// NEXT_PUBLIC_* é inlinado no bundle em tempo de build. Sem a var, o app cai no
// fallback localhost (lib/api.ts) e um deploy de produção apontaria pro
// localhost silenciosamente. Falha o build de produção pra pegar o env faltando
// no host (Vercel já tem essa var configurada). Dev mantém o fallback.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL é obrigatória no build de produção. " +
      "Configure a variável de ambiente no host (Vercel) antes de fazer o deploy.",
  );
}

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