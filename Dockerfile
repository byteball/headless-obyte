FROM node:10
WORKDIR /app

# ---- Dependencies ----
COPY package.json ./
RUN npm install --production

# ---- Copy files/build ----
COPY start.js conf.js .en? ./

CMD ["node", "start.js"]