import type { NextConfig } from "next";

// NEXT_PUBLIC_* é inlinado no bundle em tempo de build. Sem a var, o app cai no
// fallback localhost (lib/api.ts) e um deploy real apontaria pro localhost
// silenciosamente. Falha o build só no host de deploy (Vercel define VERCEL=1)
// pra pegar o env faltando; o CI só faz build de smoke-test sem a var e não
// deve quebrar. Dev mantém o fallback.
if (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL é obrigatória no build da Vercel (produção/preview). " +
      "Configure a variável de ambiente no projeto da Vercel antes de fazer o deploy.",
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