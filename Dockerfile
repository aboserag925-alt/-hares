FROM node:22-alpine AS build
WORKDIR /build
ARG SUPABASE_URL
ARG SUPABASE_ANON_PUBLIC
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_PUBLIC" npm run build:app

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /srv/ahl-athar
COPY --from=build --chown=node:node /build/index.html ./index.html
COPY --from=build --chown=node:node /build/runtime-config.js ./runtime-config.js
COPY --from=build --chown=node:node /build/app/ ./app/
COPY --from=build --chown=node:node /build/assets/ ./assets/
COPY --from=build --chown=node:node /build/screens/ ./screens/
COPY --from=build --chown=node:node /build/server/ ./server/
RUN mkdir -p storage/media && chown -R node:node storage
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
