/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdfkit"],
  outputFileTracingExcludes: {
    "*": ["./next.config.mjs"]
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
