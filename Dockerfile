FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN rm -rf node_modules/.vite && npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/ ./src/
COPY logo.png ./logo.png
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
