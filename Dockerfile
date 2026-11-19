# 2D Animation Classroom — Docker image
# ใช้ node:sqlite ที่มากับ Node.js 22 (ไม่ต้องคอมไพล์ native module)
FROM node:22-bookworm-slim

ENV NODE_ENV=development \
    DB_DRIVER=node \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_FILE=/app/data/classroom.db \
    STORAGE_DIR=/app/data/storage \
    NODE_OPTIONS=--no-warnings

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/better-sqlite3 \
 && npm cache clean --force
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts/backup-db.js scripts/reset-password.js ./scripts/

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
