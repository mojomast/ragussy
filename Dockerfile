FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
RUN cd frontend && npm install && npm run build && cd ..
RUN npm run build
RUN npm prune --omit=dev

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root runtime user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directory for state persistence
RUN mkdir -p /app/data /app/docs && chown -R appuser:appgroup /app

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

USER appuser

# Run with memory limit
CMD ["node", "--max-old-space-size=1024", "dist/index.js"]
