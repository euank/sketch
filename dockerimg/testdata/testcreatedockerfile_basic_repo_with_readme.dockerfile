FROM ghcr.io/boldsoftware/sketch:3a03b430af3cabf3415d263b7803b311

ARG GIT_USER_EMAIL
ARG GIT_USER_NAME

RUN git config --global user.email "$GIT_USER_EMAIL" && \
    git config --global user.name "$GIT_USER_NAME"

LABEL sketch_context="1904f4ae13566afc998b89a591dd37bac3bbe5ee0811b3c8c5d017baa0b7a924"
COPY . /app

WORKDIR /app
RUN if [ -f go.mod ]; then go mod download; fi

RUN echo "Setting up test project environment" || true

CMD ["/bin/sketch"]
