FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /srv/ahl-athar
COPY --chown=node:node index.html ./index.html
COPY --chown=node:node runtime-config.js ./runtime-config.js
COPY --chown=node:node app/ ./app/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node screens/ ./screens/
COPY --chown=node:node server/ ./server/
RUN mkdir -p storage/media && chown -R node:node storage
VOLUME ["/srv/ahl-athar/storage"]
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
