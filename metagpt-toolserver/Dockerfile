FROM node:20-alpine
RUN apk add --no-cache tar
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
RUN mkdir -p /output
EXPOSE 3105
CMD ["node", "index.js"]
