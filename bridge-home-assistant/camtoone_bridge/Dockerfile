FROM node@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2
RUN apk add --no-cache ffmpeg su-exec openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY entrypoint.sh /entrypoint.sh
RUN chmod -R a+rX /app && chmod +x /entrypoint.sh && mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=8099
EXPOSE 8099
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/bridge.mjs"]
