/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cryptologos.cc',
        pathname: '/**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/about',
        destination: 'https://temp-wallets-website-31wb.vercel.app',
      },
      {
        source: '/about/:path*',
        destination: 'https://temp-wallets-website-31wb.vercel.app/:path*',
      },
      {
        source: '/assets/:path*',
        destination: 'https://temp-wallets-website-31wb.vercel.app/assets/:path*',
      },
    ]
  },
};
export default nextConfig;