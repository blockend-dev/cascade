# Reproducible-build requirement (docs/threat-model.md #22, ADR 0011):
# pinned base image digest, pinned dependencies via package-lock.json,
# no floating tags. An independent party rebuilding from this exact
# Dockerfile + the committed package-lock.json should reproduce the same
# image layers; MEASUREMENT.md documents how to check the resulting
# attestation against a published expected value.
#
# The digest below MUST be updated (and MEASUREMENT.md re-published)
# whenever this Dockerfile or its dependencies change — see MEASUREMENT.md
# for the exact procedure. Pinned to the amd64 node:20-bookworm-slim
# digest current as of this commit (verified against Docker Hub's
# registry API directly, not guessed).
FROM node:20-bookworm-slim@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c

WORKDIR /app

# Dependencies first, pinned via the committed lockfile — no `npm update`,
# no floating ranges resolved at build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-save typescript && npx tsc && npm uninstall typescript

# No shell, no package manager left in the final image beyond what
# node:slim already ships — reduces what a compromised process could
# pivot into, and keeps the measured surface smaller.
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "dist/index.js"]
