import type { NextConfig } from "next";

// O browser sempre chama /api na mesma origem. O rewrite server-side evita
// cookies third-party entre Vercel e Render e mantém a sessão fora do JS.
const apiOrigin = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000')
  .replace(/\/api\/?$/, '');

if (process.env.VERCEL && !process.env.API_URL && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "API_URL é obrigatória no build da Vercel (produção/preview). " +
      "Configure a variável de ambiente no projeto da Vercel antes de fazer o deploy.",
  );
}

const nextConfig: NextConfig = {
  transpilePackages: ["@qara/shared"],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  // @qara/shared usa especificadores NodeNext ('./x.js' apontando pra fonte
  // .ts) porque o apps/api também o consome; ensina o webpack a resolvê-los.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};

export default nextConfig;
