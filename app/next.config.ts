import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A imagem Docker executa o servidor standalone do Next.js.
  output: process.env.BILLR_CONTAINER_BUILD === 'true' ? 'standalone' : undefined,
  experimental:
    process.env.BILLR_CONTAINER_BUILD === 'true'
      ? { cpus: 1, webpackMemoryOptimizations: true }
      : {},
  // Server actions incluem senhas e dados de faturas; nunca imprima os argumentos.
  logging: { serverFunctions: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // URLs públicas de faturas/orçamentos carregam o public_id secreto no
          // caminho; impeça que ele seja enviado a terceiros no cabeçalho Referer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ]
  },
}

export default nextConfig
