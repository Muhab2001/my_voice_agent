FROM oven/bun:1.3.11

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --linker hoisted

# Free Render web services do not support pre-deploy commands. Migrations are
# idempotent and run before the API accepts traffic on each process start.
CMD ["sh", "-c", "bun run migrate && exec bun run --cwd apps/api start"]
