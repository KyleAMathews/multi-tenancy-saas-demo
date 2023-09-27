# base node image
FROM node:20-bullseye-slim as base
SHELL ["/bin/bash", "-c"]
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
ENV TURSO_AUTH_TOKEN=$TURSO_AUTH_TOKEN


# set for base and all layer that inherit from it
ENV NODE_ENV production

# Setup production node_modules
FROM base as app

WORKDIR /root-app/app

ADD app-admin/ .
ADD machines ../machines
ENV NODE_ENV=development
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ENV NODE_ENV=production
RUN pnpm build

# Install all node_modules, including dev dependencies
FROM base as serverDeps

RUN apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSfL https://gist.githubusercontent.com/KyleAMathews/e7678b4d13adb24e6b5331a89e3b30a8/raw/d3a1b1ee70313b30e92fa092ce1b330fad8be711/install-turso.sh | bash
RUN source /root/.bashrc
RUN /root/.turso/turso --version

WORKDIR /root-app/server

ADD server/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ADD machines ../machines
add server/map-sqlite-resultset.ts package.json ..

COPY --from=app /root-app/app/dist dist

ENTRYPOINT ["/bin/bash", "-c", "source /root/.bashrc && npm run start"]
# CMD [ "npm", "run", "start" ]
