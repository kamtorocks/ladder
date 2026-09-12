# syntax=docker/dockerfile:1
ARG PB_VERSION=0.40.4

FROM alpine:3.22 AS fetch
ARG PB_VERSION
ARG TARGETARCH
RUN apk add --no-cache ca-certificates \
 && wget -qO /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && mkdir -p /pb && unzip -q /tmp/pb.zip pocketbase -d /pb && chmod +x /pb/pocketbase

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
COPY --from=fetch /pb/pocketbase /pb/pocketbase
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
WORKDIR /pb
VOLUME ["/pb/pb_data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health >/dev/null || exit 1
ENTRYPOINT ["/pb/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", "--hooksWatch=false"]
