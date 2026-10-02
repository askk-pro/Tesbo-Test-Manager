import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  // Repo root has a lockfile but no `next`; pin Turbopack root so `next` resolves.
  turbopack: {
    root: __dirname,
  },
};

// Source maps upload is opt-in via SENTRY_AUTH_TOKEN on stage CI only.
const sentryWebpackPluginOptions = {
  org: "qable",
  project: "app-tesbo-stage",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
