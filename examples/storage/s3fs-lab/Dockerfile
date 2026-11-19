FROM ubuntu:24.04 AS build
ARG S3FS_VERSION=1.97
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential automake autoconf libtool pkg-config git ca-certificates \
    libfuse3-dev libcurl4-openssl-dev libxml2-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "v${S3FS_VERSION}" \
    https://github.com/s3fs-fuse/s3fs-fuse.git /src \
    && cd /src && git rev-parse HEAD && ./autogen.sh \
    && ./configure --prefix=/usr --with-openssl \
    && make -j2 && make DESTDIR=/stage install

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fuse3 libcurl4t64 libxml2 libssl3t64 libstdc++6 media-types util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /stage/usr/bin/s3fs /usr/local/bin/s3fs
COPY run-readonly.sh /usr/local/bin/run-readonly.sh
RUN chmod 0755 /usr/local/bin/run-readonly.sh \
    && mkdir -p /mnt/s3 /var/cache/s3fs/data /var/cache/s3fs/tmp \
    && /usr/local/bin/s3fs --version
USER 0:0
ENTRYPOINT ["/usr/local/bin/run-readonly.sh"]
