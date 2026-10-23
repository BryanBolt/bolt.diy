FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/index.ts"]
