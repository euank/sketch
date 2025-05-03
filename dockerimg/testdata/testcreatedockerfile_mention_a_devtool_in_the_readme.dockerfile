FROM ghcr.io/boldsoftware/sketch:99a2e4afe316b3c6cf138830dbfb7796

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME" && \
    git config --global http.postBuffer 524288000

LABEL sketch_context="4b57cd5672dffa6afe8495834d5965702be578e00b3ef168060630c7d1889fd9"
COPY . /app
RUN rm -f /app/tmp-sketch-dockerfile

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

# Switch to lenient shell so we are more likely to get past failing extra_cmds.
SHELL ["/bin/bash", "-uo", "pipefail", "-c"]

RUN apt-get update && \
    apt-get install -y --no-install-recommends graphviz || true && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Python environment setup with error handling
RUN if [ -f requirements.txt ]; then \
    pip3 install -r requirements.txt || true; \
fi

# Switch back to strict shell after extra_cmds.
SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

CMD ["/bin/sketch"]
