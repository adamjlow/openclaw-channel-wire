# openclaw-channel-wire test image.
# The official OpenClaw image is bookworm (glibc 2.36); Wire's CoreCrypto needs
# glibc >= 2.38, so we build on Debian trixie with Node 24.
FROM node:24-trixie-slim

ARG OPENCLAW_VERSION=2026.9.6
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" --allow-scripts=openclaw --no-audit --no-fund \
 && openclaw --version

COPY --chmod=0755 entrypoint.sh /usr/local/bin/openclaw-wire-entrypoint

ENV OPENCLAW_STATE_DIR=/home/node/.openclaw
USER node
WORKDIR /home/node
RUN mkdir -p "${OPENCLAW_STATE_DIR}"

EXPOSE 18789
ENTRYPOINT ["openclaw-wire-entrypoint"]
CMD ["gateway"]
