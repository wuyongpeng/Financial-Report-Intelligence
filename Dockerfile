FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Poppler is the deterministic fallback for Chinese PDFs whose embedded fonts
# do not expose usable Unicode text to PDF.js.
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list; \
  fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

COPY . ./
RUN npm run build \
  && mkdir -p .next/standalone/.next \
  && cp -r .next/static .next/standalone/.next/static \
  && if [ -d public ]; then cp -r public .next/standalone/public; fi \
  && mkdir -p .next/standalone/data \
  && cp -r data/industry-skills .next/standalone/data/industry-skills \
  && if [ -f data/companies.json ]; then cp data/companies.json .next/standalone/data/companies.json; fi \
  && rm -rf .next/standalone/data/reports data/reports \
  && find .next/standalone -type f -name '*.pdf' -delete

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
