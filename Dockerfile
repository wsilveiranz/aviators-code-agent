FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ src/

EXPOSE 3001 8088

CMD ["node", "src/server.js"]
