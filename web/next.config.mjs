/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Remote listing/photo hosts are added here once a real MLS/IDX/RESO
    // image CDN is wired in. Mock listings use Unsplash placeholders for now.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;
