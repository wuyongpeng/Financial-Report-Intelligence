FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Poppler is the deterministic fallback for Chinese PDFs whose embedded fonts
# do not expose usable Unicode text to PDF.js.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build \
  && mkdir -p .next/standalone/.next \
  && cp -r .next/static .next/standalone/.next/static \
  && if [ -d public ]; then cp -r public .next/standalone/public; fi

EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
