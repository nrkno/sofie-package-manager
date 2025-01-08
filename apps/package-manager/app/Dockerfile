FROM node:18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/package-manager/app/Dockerfile -t pm-package-manager .
# docker build -t pm-package-manager ../../../..

# Environment

WORKDIR /src

# Common

COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json .yarnrc.yml ./
COPY scripts ./scripts
COPY .yarn ./.yarn

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/package-manager
COPY apps/package-manager/packages apps/package-manager/packages

# App
COPY apps/package-manager/app apps/package-manager/app

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


WORKDIR /src/apps/package-manager/app
ENV package-manager_PORT=8070
EXPOSE 8070

CMD ["yarn", "start"]
