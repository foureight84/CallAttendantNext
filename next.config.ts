import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client', 'serialport', 'onoff'],
};

export default nextConfig;
