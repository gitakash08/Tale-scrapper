/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg is a server-only native-ish dep; keep it external to the bundle.
  serverExternalPackages: ["pg"],
  // This app lives in gui/ next to the worker's own lockfile — pin the trace
  // root here so Next doesn't warn about the two lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
