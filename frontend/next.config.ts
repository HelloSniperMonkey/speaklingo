import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-1487412720507-e7ab37603c6f" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-1500648767791-00dcc994a43e" },
    ],
  },
};

export default nextConfig;
