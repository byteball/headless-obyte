FROM node:10

RUN mkdir -p /home/node/obyte &&\
	chown -R node:node /home/node/obyte

USER node

ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=$PATH:/home/node/.npm-global/bin

WORKDIR /home/node/obyte

## Dependencies
COPY package*.json ./
RUN ls -la
RUN npm install --production

## Copy files/build
COPY docker-entrypoint.sh start.js conf.js .en? ./

USER root
RUN chmod +x docker-entrypoint.sh

USER node

VOLUME /home/node/.config
ENTRYPOINT ["/bin/bash", "docker-entrypoint.sh"]