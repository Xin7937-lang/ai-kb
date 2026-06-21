/** @type {import('next').NextConfig} */
// Next.js bundles its own webpack internally; import from there to avoid
// pulling in a second webpack copy at the config layer.
const webpack = (await import('next/dist/compiled/webpack/webpack-lib.js')).default;

const nextConfig = {
  output: 'standalone',

  webpack: (config, { isServer }) => {
    // Workaround for a Next.js 14.2.7 + webpack 5 bug: the bundler
    // chokes on `node:xxx` URI scheme imports ("UnhandledSchemeError:
    // Reading from 'node:async_hooks' is not handled by plugins").
    // Both Next.js's own internal modules and the wider Node ecosystem
    // are increasingly using the `node:` prefix, which webpack 5 has
    // no built-in handler for. Rewrite `node:foo` → `foo` at the
    // module-resolution layer so webpack treats them as plain Node
    // built-ins.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
    );
    return config;
  },

  experimental: {
    // Note: `instrumentationHook: true` (which would auto-run migrations
    // on server start via `instrumentation.ts`) is intentionally NOT
    // enabled — it triggers an upstream webpack bug in Next 14.2.7
    // ("stream did not contain valid UTF-8") for the standalone build.
    // Run `npm run bootstrap` once after deploy / on first start to
    // create tables + hash the initial password. See scripts/bootstrap.ts.

    serverActions: {
      bodySizeLimit: '10mb',
    },

    // Native modules + Node-only libs must NOT be bundled into the
    // standalone server — they are loaded from node_modules at runtime.
    // - better-sqlite3: native .node binding
    // - archiver / unzipper: pull in optional `require()`s of packages
    //   we don't ship (e.g. @aws-sdk/client-s3); keeping them external
    //   means webpack doesn't try to resolve those.
    serverComponentsExternalPackages: [
      'better-sqlite3',
      'archiver',
      'unzipper',
      'zhipuai',  // has node-fetch + jsonwebtoken + agentkeepalive; keep external
      'sqlite-vec', // native .node binding + import.meta.resolve — must stay external
    ],
  },

  // Strict mode for catching bugs early
  reactStrictMode: true,

  // Disable x-powered-by for security
  poweredByHeader: false,
};

export default nextConfig;
