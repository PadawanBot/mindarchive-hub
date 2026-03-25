/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force unique build ID per deploy — busts Vercel build cache
  generateBuildId: () => `build-${Date.now()}`,
};

export default nextConfig;
