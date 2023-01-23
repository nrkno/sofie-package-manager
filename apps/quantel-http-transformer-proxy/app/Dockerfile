FROM node:14.18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/quantel-http-transformer-proxy/app/Dockerfile -t pm-quantel-http-transformer-proxy .
# docker build -t pm-quantel-http-transformer-proxy ../../../..

# Environment

WORKDIR /src

# Common


COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json ./
COPY scripts ./scripts

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/quantel-http-transformer-proxy
COPY apps/quantel-http-transformer-proxy/packages apps/quantel-http-transformer-proxy/packages

# App
COPY apps/quantel-http-transformer-proxy/app apps/quantel-http-transformer-proxy/app

# Install
RUN yarn install

# Build
RUN yarn build

# Purge dev-dependencies
RUN yarn install --check-files --frozen-lockfile --production --force --ignore-scripts
RUN rm -r scripts


# Create deploy-image:
FROM node:14-alpine as builder

COPY --from=builder /src /src


WORKDIR /src/apps/quantel-http-transformer-proxy/app
ENV QUANTEL_HTTP_TRANSFORMER_PROXY_PORT=8080
# ENV QUANTEL_HTTP_TRANSFORMER_URL= // This is mandatory: docker run --env QUANTEL_HTTP_TRANSFORMER_URL="http://transformer"
# ENV QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_DURATION=
# ENV QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_MAX=
EXPOSE 8080

CMD ["yarn", "start"]
