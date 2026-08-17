# Settebello — 7-bój w Toskanii.
# Obraz nie instaluje niczego z npm: aplikacja nie ma zależności, a SQLite
# jest wbudowany w Node 24. Dlatego nie ma tu warstwy `npm install`.

FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3051 \
    SETTEBELLO_DB=/data/settebello.db

WORKDIR /app

COPY package.json ./
COPY config.mjs engines.mjs server.mjs ./
COPY public ./public

# Wyniki żyją w wolumenie, więc przebudowa obrazu ich nie rusza.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3051
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
