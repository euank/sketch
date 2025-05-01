FROM ghcr.io/boldsoftware/sketch:3a03b430af3cabf3415d263b7803b311

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME"

LABEL sketch_context="00e8cee1c3621b40cc6b977430392a621b3d8dea06b12191c082f9bda155832b"
COPY . /app

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

# Install Python 3.11 and set it up as the default python3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3.11 python3.11-venv python3-pip || true && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create symlink to make python3.11 the default python3
RUN if [ -f /usr/bin/python3.11 ]; then \
      update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1; \
    fi

# Install dvc (Data Version Control) as mentioned in README
RUN pip3 install dvc || true

CMD ["/bin/sketch"]
