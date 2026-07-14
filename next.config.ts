import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const isCloudBaseStatic = process.env.CLOUDBASE_STATIC === "true";
const isCloudBaseStandalone = process.env.CLOUDBASE_STANDALONE === "true";
const isStaticExport = isGitHubPages || isCloudBaseStatic;
const repoName = "WorkOS";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : isCloudBaseStandalone ? "standalone" : undefined,
  outputFileTracingRoot: process.cwd(),
  basePath: isGitHubPages ? `/${repoName}` : undefined,
  assetPrefix: isGitHubPages ? `/${repoName}/` : undefined,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStaticExport ? "true" : "false",
  },
};

export default nextConfig;
