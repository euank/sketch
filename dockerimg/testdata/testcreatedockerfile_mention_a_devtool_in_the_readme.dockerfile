FROM ghcr.io/boldsoftware/sketch:3a03b430af3cabf3415d263b7803b311

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME"

LABEL sketch_context="7f3bb0ff41be88d7916a3757975c3adfd67f265d6e5dff4ca7d6486e93677d1c"
COPY . /app

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

RUN apt-get update && apt-get install -y graphviz || true

CMD ["/bin/sketch"]
