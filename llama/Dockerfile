FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS node-runtime

FROM ghcr.io/ggml-org/llama.cpp@sha256:5268283a8d6510d167364f19aee93e98180d8eb0cac4b7edb20af7e3edf40c17

ENV LLAMA_MANIFEST_PATH=/opt/chess-llama/runtime-manifest.json \
    LLAMA_MODEL_DIRECTORY=/models
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY config/runtime-manifest.json /opt/chess-llama/runtime-manifest.json
COPY llama/model-bootstrap.mjs llama/entrypoint.sh /opt/chess-llama/
ENTRYPOINT ["/opt/chess-llama/entrypoint.sh"]
CMD ["/bin/sh", "-c", "exec /app/llama-server --model /models/current.gguf --host 0.0.0.0 --port 8080 --ctx-size \"$LLAMA_CONTEXT_SIZE\" --n-gpu-layers \"$LLAMA_GPU_LAYERS\" --flash-attn on --parallel 1 --alias \"$LLAMA_PROFILE_ID\" --no-webui"]
