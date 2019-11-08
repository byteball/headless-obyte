FROM node:10
WORKDIR /app

# ---- Dependencies ----
COPY package.json ./
RUN npm install --production

# ---- Copy files/build ----
COPY docker-entrypoint.sh start.js conf.js .en? ./
RUN chmod +x docker-entrypoint.sh

VOLUME ["/root"]
ENTRYPOINT ["/bin/bash", "docker-entrypoint.sh"]