# Two images from one file:
#   docker build --target web    → nginx: the built site + proxy of /api to the server container
#   docker build --target server → Node + Hono: the JSON API
# Both carry the same VERSION file (the one version of the app).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json VERSION ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
COPY server server
RUN npm run build

# Production dependencies of the server only (no Vite, React or test tools).
FROM node:24-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server

FROM node:24-alpine AS server
ENV NODE_ENV=production \
    PORT=8080 \
    STATE_DIR=/app/state
WORKDIR /app/server
# Station → town answers survive restarts here (a named volume in docker-compose.yml).
RUN mkdir -p /app/state && chown node:node /app/state
# Same layout as the repository: server/dist/*.js reads ../../VERSION = /app/VERSION.
COPY --from=server-deps /app/node_modules /app/node_modules
COPY --from=build /app/VERSION /app/VERSION
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["node", "dist/index.js"]

FROM nginx:1.29-alpine AS web
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY --from=build /app/VERSION /usr/share/nginx/html/VERSION
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/VERSION || exit 1
