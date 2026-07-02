// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      (warning) => {
        return (
          warning.message &&
          warning.message.includes('multiple modules with names that only differ in casing')
        );
      },
    ];
    return config;
  },
};

export default nextConfig;