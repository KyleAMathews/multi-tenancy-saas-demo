# base node image
FROM node:20-bullseye-slim as base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

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

WORKDIR /root-app/server

ADD server/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ADD machines ../machines
add map-sqlite-resultset.ts package.json ..

COPY --from=app /root-app/app/dist dist

CMD [ "npm", "run", "start" ]
