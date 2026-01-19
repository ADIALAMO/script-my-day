/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // כאן ההגדרה עברה למקום החדש והנכון:
  serverExternalPackages: ['ioredis'],
};

export default nextConfig;