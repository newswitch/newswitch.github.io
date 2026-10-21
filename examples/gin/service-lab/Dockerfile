FROM golang:1.27.3-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/taskd ./cmd/taskd

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY --from=build /out/taskd /usr/local/bin/taskd
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/taskd"]
CMD ["-listen=0.0.0.0:8084"]
