# ---- Base Node ----
FROM node:8 AS base
WORKDIR /app

# ---- Dependencies ----
FROM base AS dependencies
COPY package*.json ./
RUN npm install

# ---- Copy files/build ----
FROM dependencies AS build
WORKDIR /app
COPY start.js conf.js .en? ./

# ---- Release ----
FROM node:8-alpine AS release
ARG APP_PORT=6611
ARG RPC_PORT=6332
ARG testnet=0
WORKDIR /app
COPY --from=dependencies /app/package.json ./
RUN apk add --no-cache git \
  && apk --no-cache --virtual build-dependencies add python \
  make \
  g++ \
  && npm install --production \
  && apk del build-dependencies
COPY --from=build /app ./

EXPOSE ${APP_PORT} ${RPC_PORT}
CMD ["node", "start.js"]