FROM node:22-alpine

WORKDIR /app
COPY src/ src/
COPY examples/ examples/
COPY package.json ./

EXPOSE 3000
CMD ["node", "examples/server.js"]
