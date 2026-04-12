FROM node:18-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && pip3 install yt-dlp \
    && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=10000
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "server.js"]
