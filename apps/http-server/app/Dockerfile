FROM node:14.18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/http-server/app/Dockerfile -t pm-http-server .
# docker build -t pm-http-server ../../../..

# Environment

WORKDIR /src

# Common


COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json ./
COPY scripts ./scripts

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/http-server
COPY apps/http-server/packages apps/http-server/packages

# App
COPY apps/http-server/app apps/http-server/app

# Install
RUN yarn install

# Build
RUN yarn build

# Purge dev-dependencies
RUN yarn install --check-files --frozen-lockfile --production --force --ignore-scripts
RUN rm -r scripts


# Create deploy-image:
FROM node:14-alpine

COPY --from=builder /src /src


WORKDIR /src/apps/http-server/app
ENV HTTP_SERVER_PORT=8080
# ENV HTTP_SERVER_API_KEY_READ=
# ENV HTTP_SERVER_API_KEY_WRITE=
ENV HTTP_SERVER_BASE_PATH="/data"
EXPOSE 8080

CMD ["yarn", "start"]
