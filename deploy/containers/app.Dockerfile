FROM docker.io/library/node:22-bookworm-slim AS newui-build
WORKDIR /source/deploy/new_html
COPY deploy/new_html/package.json deploy/new_html/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY deploy/new_html ./
RUN npm run build

FROM docker.io/library/node:22-bookworm-slim AS studio-build
WORKDIR /source/studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio ./
COPY deploy/new_html /source/deploy/new_html
COPY --from=newui-build /source/deploy/new_html/node_modules /source/deploy/new_html/node_modules
RUN npm run build

FROM docker.io/library/python:3.12-slim-bookworm AS runtime
ARG GIT_SHA=unknown
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GIT_SHA=${GIT_SHA}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deploy/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY deploy ./
COPY --from=newui-build /source/deploy/dist ./dist
COPY --from=studio-build /source/studio/dist /studio/dist
RUN chmod 0755 ./containers/entrypoint.sh \
    && mkdir -p persistent_storage temp/uploads uploads outputs logs history

EXPOSE 6006
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:6006/health >/dev/null || exit 1

ENTRYPOINT ["./containers/entrypoint.sh"]
