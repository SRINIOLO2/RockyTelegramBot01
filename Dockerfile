# Stage 1: Build TypeScript code
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

COPY src/ ./src
RUN npm run build

# Stage 2: Production runtime environment
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Create the data directory for token persistence
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
