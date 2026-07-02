/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your existing webpack config (if you need it for production)
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
  // Add this line to silence the Turbopack warning
  turbopack: {},
};

module.exports = nextConfig;