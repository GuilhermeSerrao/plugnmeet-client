# Build context must be the repo root (this Dockerfile needs ../src/PlugNMeetClient.js).
# docker build -f dashboard/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json dashboard/
RUN cd dashboard && npm ci
COPY dashboard/ dashboard/
RUN cd dashboard && npm run build

FROM node:22-alpine
WORKDIR /app
COPY src/ src/
COPY dashboard/server.js dashboard/server.js
COPY dashboard/public/ dashboard/public/
COPY --from=builder /app/dashboard/dist dashboard/dist

WORKDIR /app/dashboard
EXPOSE 3000
CMD ["node", "server.js"]
