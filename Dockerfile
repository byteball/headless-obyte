FROM node:10
WORKDIR /app

# ---- Dependencies ----
COPY package.json ./
RUN npm install --production

# ---- Copy files/build ----
COPY start.js conf.js .en? ./
VOLUME ["/root"]
CMD ["node", "start.js"]