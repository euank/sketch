FROM ghcr.io/boldsoftware/sketch:3a03b430af3cabf3415d263b7803b311

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME"

LABEL sketch_context="6f16c9b83fbd20e2eb242922989364954adb4905ab8c562baf2bc906ee347da5"
COPY . /app

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

# Install any Python dependencies but continue if setup fails
RUN if [ -f requirements.txt ]; then pip3 install -r requirements.txt || true; fi

# Ensure Go development tools are properly set up
RUN go mod tidy || true

CMD ["/bin/sketch"]
