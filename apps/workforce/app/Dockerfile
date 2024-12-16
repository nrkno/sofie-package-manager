FROM node:18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/workforce/app/Dockerfile -t pm-workforce .
# docker build -t pm-workforce ../../../..

# Environment

WORKDIR /src

# Common

COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json .yarnrc.yml ./
COPY scripts ./scripts
COPY .yarn ./.yarn

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/workforce
COPY apps/workforce/packages apps/workforce/packages

# App
COPY apps/workforce/app apps/workforce/app

# Install
RUN yarn install

# Build
RUN yarn build

# Purge dev-dependencies:
RUN yarn workspaces focus -A --production

RUN rm -r scripts


# Create deploy-image:
FROM node:18-alpine

COPY --from=builder /src /src


WORKDIR /src/apps/workforce/app
ENV WORKFORCE_PORT=8070
EXPOSE 8070

CMD ["yarn", "start"]
