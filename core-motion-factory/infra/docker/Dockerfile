# CORE Motion Factory — one image, two roles (web | worker). by HAXIS Core
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl bzip2 fonts-inter \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 libdrm2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/renderer/package.json apps/renderer/
COPY packages ./packages-manifests
RUN for d in packages-manifests/*; do mkdir -p packages/$(basename $d) && cp $d/package.json packages/$(basename $d)/; done && rm -rf packages-manifests
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Chrome for Remotion is downloaded on first render unless CMF_CHROME_EXECUTABLE points to one.
RUN npx remotion browser ensure || true
EXPOSE 3000
CMD ["npm", "run", "start:web"]
