FROM ghcr.io/boldsoftware/sketch:99a2e4afe316b3c6cf138830dbfb7796

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME" && \
    git config --global http.postBuffer 524288000

LABEL sketch_context="7c933e98fc1d5fd35f964b6cf115bcf65b580c378069d078ab66723b2b1073c4"
COPY . /app
RUN rm -f /app/tmp-sketch-dockerfile

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

# Switch to lenient shell so we are more likely to get past failing extra_cmds.
SHELL ["/bin/bash", "-uo", "pipefail", "-c"]

# Install Python 3.11 (attempt to continue on failure)
RUN apt-get update && apt-get install -y --no-install-recommends python3.11 python3.11-venv python3.11-dev python3-pip || true

# Set up Python 3.11 as default Python
RUN if command -v python3.11 &> /dev/null; then \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 || true; \
    fi

# Install DVC tool
RUN pip3 install dvc || true

# Create and activate Python virtual environment if needed
RUN if [ -f requirements.txt ]; then \
    python3 -m venv .venv || true; \
    source .venv/bin/activate || true; \
    pip install -r requirements.txt || true; \
    fi

# Switch back to strict shell after extra_cmds.
SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

CMD ["/bin/sketch"]
