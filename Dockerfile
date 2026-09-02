### Default image is base. You can add other support by modifying BASE_IMAGE_TAG. The following parameters are supported: base (default), aria2, ffmpeg, aio
ARG BASE_IMAGE_TAG=base

FROM alpine:edge AS builder
LABEL stage=go-builder
# override with --build-arg GOPROXY=... when building from networks that
# cannot reach proxy.golang.org (e.g. CN)
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
WORKDIR /app/
RUN apk add --no-cache bash curl jq gcc git go musl-dev nodejs
COPY go.mod go.sum ./
RUN go mod download
COPY ./ ./
RUN bash build.sh release docker

FROM openlistteam/openlist-base-image:${BASE_IMAGE_TAG}
LABEL MAINTAINER="OpenList"
ARG INSTALL_FFMPEG=false
ARG INSTALL_ARIA2=false
ARG USER=openlist
ARG UID=1001
ARG GID=1001

WORKDIR /opt/openlist/

RUN addgroup -g ${GID} ${USER} && \
    adduser -D -u ${UID} -G ${USER} ${USER} && \
    mkdir -p /opt/openlist/data

COPY --from=builder --chmod=755 --chown=${UID}:${GID} /app/bin/openlist ./
COPY --chmod=755 --chown=${UID}:${GID} entrypoint.sh /entrypoint.sh

USER ${USER}
RUN /entrypoint.sh version

ENV UMASK=022 RUN_ARIA2=${INSTALL_ARIA2}
VOLUME /opt/openlist/data/
EXPOSE 5244 5245
CMD [ "/entrypoint.sh" ]
