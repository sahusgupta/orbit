import type { NextConfig } from 'next';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd(), '..');

const nextConfig: NextConfig = {
  agentRules: false,
  compiler: {
    removeConsole: { exclude: ['error'] }
  },
  experimental: {
    optimizePackageImports: ['lucide-react']
  },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  outputFileTracingRoot: repositoryRoot,
  turbopack: {
    root: repositoryRoot
  }
};

export default nextConfig;
