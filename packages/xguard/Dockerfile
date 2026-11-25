# syntax=docker/dockerfile:1
#
# Builds and runs @xhis/xguard's cluster-connectivity smoke test (see
# `src/runner/clusterConnectivitySmokeTest.ts`'s own doc comment for
# exactly what this does and doesn't prove: real-cluster RBAC and
# API-server reachability, not a running self-healing controller --
# no real telemetry adapter or identity provider exists yet for one).
#
# Built from the monorepo root as context, since this is an npm
# workspaces package and its one in-repo dependency (@xhis/core) has
# to be built first either way:
#
#   docker build -f packages/xguard/Dockerfile -t xguard-ops:dev .
#
# `helm/xguard-ops` is the chart that deploys this image with the
# ServiceAccount/RBAC it actually needs.

FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/xhis-core/package.json packages/xhis-core/package.json
COPY packages/xguard/package.json packages/xguard/package.json
# Only these two workspaces are ever installed or built here --
# packages/postgres-shell isn't copied into this build context at all,
# so npm's "packages/*" glob never sees it.
RUN npm ci --workspace=@xhis/core --workspace=@xhis/xguard --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/xhis-core/ packages/xhis-core/
COPY packages/xguard/ packages/xguard/
RUN npm run build --workspace=@xhis/xguard

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/packages/xhis-core/package.json packages/xhis-core/package.json
COPY --from=build /workspace/packages/xhis-core/dist packages/xhis-core/dist
COPY --from=build /workspace/packages/xguard/package.json packages/xguard/package.json
COPY --from=build /workspace/packages/xguard/dist packages/xguard/dist

# A dedicated, unprivileged user -- this image only ever needs the
# Kubernetes permissions its ServiceAccount's RBAC grants (see
# `helm/xguard-ops/templates/rbac.yaml`), never root on the node it
# happens to run on.
RUN addgroup -S xguard && adduser -S xguard -G xguard
USER xguard

WORKDIR /workspace/packages/xguard
CMD ["node", "dist/runner/clusterConnectivitySmokeTest.js"]
