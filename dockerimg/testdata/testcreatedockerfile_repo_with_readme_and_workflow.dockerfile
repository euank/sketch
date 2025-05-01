FROM ghcr.io/boldsoftware/sketch:3a03b430af3cabf3415d263b7803b311

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME"

LABEL sketch_context="ff4ffb8b67de82930fc2bae9297a8d3fdf4593f64a2a050a58a279d77b65deb8"
COPY . /app

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

# Install Node.js 18 and enable corepack as used in GitHub workflow
RUN npm install -g corepack && corepack enable

# If Python packages are needed, make it fault-tolerant
RUN pip3 install -r requirements.txt 2>/dev/null || true

CMD ["/bin/sketch"]
