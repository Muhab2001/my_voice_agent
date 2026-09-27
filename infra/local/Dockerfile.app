FROM oven/bun:1.3.11 AS pruner
WORKDIR /app
RUN bun install --global turbo@2.11.4
COPY . .
ARG TARGET
RUN turbo prune "$TARGET" --docker

FROM oven/bun:1.3.11
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
COPY tsconfig.json ./
RUN bun install --frozen-lockfile --linker hoisted
COPY --from=pruner /app/out/full/ ./
