FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 minio && useradd --uid 10001 --gid 10001 --no-create-home minio \
    && mkdir /data1 /data2 && chown 10001:10001 /data1 /data2
COPY minio /usr/local/bin/minio
COPY entrypoint.sh /usr/local/bin/lab-entrypoint
RUN chmod 0755 /usr/local/bin/minio /usr/local/bin/lab-entrypoint
ENTRYPOINT ["/usr/local/bin/lab-entrypoint"]
