FROM golang:alpine

RUN apk update

# -- Build the go stuff -------------------------v
RUN apk add --update git && \
    rm -rf /var/cache/apk/*
RUN go get github.com/constabulary/gb/... && \
    go install github.com/constabulary/gb
RUN apk add --update build-base

COPY src /go/src/matrix-search/src
COPY vendor /go/src/matrix-search/vendor

WORKDIR /go/src/matrix-search
RUN gb build

# -- Build the node stuff -----------------------v
RUN apk add --update nodejs nodejs-npm
# Python and make node gyp :(
RUN apk add --update python make

COPY server /node/server
WORKDIR /node/server
RUN npm i

# -- Scripts ------------------------------------v
COPY ./run.sh run.sh
RUN chmod +x ./run.sh

CMD /go/src/matrix-search/bin/matrix-search-local & ./run.sh
