# Playwright's image carries Chromium plus the system libraries it needs; the
# tag must track the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production
ENV DISPLAY=:99

# Xvfb gives Chromium a real (if virtual) display so it runs headful; x11vnc
# exposes that display for the one-time interactive Reddit login.
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb x11vnc x11-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY config ./config
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
