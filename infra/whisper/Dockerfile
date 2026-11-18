FROM node:24-bookworm-slim AS build
ARG WHISPER_REF=48f628a84833905ee4a0658ee6d4a5c915ce1997
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/${WHISPER_REF}" -o source.tar.gz \
    && tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
    && cmake --build build --target whisper-cli -j 2

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-cli /opt/whisper/whisper-cli
COPY worker.mjs /opt/whisper/worker.mjs
USER node
CMD ["node", "/opt/whisper/worker.mjs"]
