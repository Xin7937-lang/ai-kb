# ---- Stage 1: deps ----
# Install all dependencies (including dev) needed to build.
# Build tools (python3/make/g++) are required by better-sqlite3 to compile
# its native binding against the Alpine/musl toolchain.
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ---- Stage 2: builder ----
# Compile the Next.js standalone bundle. Native modules (better-sqlite3)
# are kept external by next.config.mjs (`serverComponentsExternalPackages`),
# so they end up in .next/standalone/node_modules and resolve at runtime.
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure public/ exists so the runner copy below never fails on a fresh checkout.
RUN mkdir -p public
RUN npm run build

# ---- Stage 3: runner ----
# Minimal runtime: standalone server + source needed for bootstrap.
# tsx + TypeScript source (scripts/, lib/) are kept so `bootstrap`
# can apply pending migrations. Runs as a non-root user.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S ai-kb -G nodejs

# Standalone output: server.js, package.json, production node_modules
COPY --from=builder --chown=ai-kb:nodejs /app/.next/standalone ./
# Static chunks referenced by the App Router
COPY --from=builder --chown=ai-kb:nodejs /app/.next/static ./.next/static
# User-served static assets (may be empty)
COPY --from=builder --chown=ai-kb:nodejs /app/public ./public

# tsx + TypeScript source for `npm run bootstrap`
COPY --from=builder --chown=ai-kb:nodejs /app/scripts ./scripts
COPY --from=builder --chown=ai-kb:nodejs /app/lib      ./lib

# Full node_modules from the builder (includes tsx, esbuild, bcryptjs,
# better-sqlite3, etc.) layered over the standalone's production subset.
# The COPY covers anything bootstrap.ts or its imports might need.
COPY --from=builder --chown=ai-kb:nodejs /app/node_modules ./node_modules

USER ai-kb
EXPOSE 3000

CMD ["node", "server.js"]
