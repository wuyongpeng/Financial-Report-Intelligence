import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/docs': ['./docs/**/*.md'],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
