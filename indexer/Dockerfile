# Cascade indexer — a real, always-on process (persistent SQLite +
# an indefinite chain-sync loop), never a serverless function; this
# is why it's deployed separately from web/'s Vercel deployment. See
# docs/indexer.md.
#
# Build context is the REPO ROOT (not indexer/) — indexer/src imports
# sdk/src directly across the package boundary (same pattern as
# web/), so sdk/'s source and dependencies must be present at build
# time too. See fly.toml's [build] section.

FROM node:22-alpine AS build
WORKDIR /app

COPY sdk/package.json sdk/package-lock.json ./sdk/
RUN cd sdk && npm ci

COPY indexer/package.json indexer/package-lock.json ./indexer/
RUN cd indexer && npm ci

COPY sdk/src ./sdk/src
COPY indexer/src ./indexer/src
COPY indexer/tsconfig.json ./indexer/tsconfig.json
RUN cd indexer && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app/indexer

# tsc's inferred rootDir spans both packages (indexer/src imports
# sdk/src directly), so indexer/dist/ already contains BOTH
# dist/indexer/src/*.js AND a compiled dist/sdk/src/*.js alongside it
# — fully self-contained, nothing further needed from sdk/ here.
COPY --from=build /app/indexer/node_modules ./node_modules
COPY --from=build /app/indexer/dist ./dist

EXPOSE 8788
CMD ["node", "dist/indexer/src/main.js"]
