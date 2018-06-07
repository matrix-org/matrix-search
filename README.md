# matrix-search

matrix-search will be a Full Text Search engine for Matrix, providing improved query searching, performance and ability to be ran locally, with E2E capabilities.

This project uses `gb`.

# Volatility
This project is in rapid-development so things may change entirely day-to-day. ~~This is not something that is usable yet.~~

# Local Daemon
The project is in a working (not user friendly) state.
To get started:
1. Ensure you have `node` `npm`/`yarn` `go>=1.7` `gb` `git` installed and working.
2. Clone this repository, and enter it
3. build the Go portion by running `gb build`
4. execute the created executable in the background or in another terminal; e.g `./bin/matrix-search-local &`
5. navigate to the go portion using `cd server`
6. install dependencies using `npm i` or `yarn i`
7. run Node script using `node index.js --url=$HSURL --username=$USERNAME --password=$PASSWORD` replacing the three variables appropriately.

You will need to run a modified Matrix client which sends `/search` requests to `localhost:8000` or whatever port you specify to Node using `--port=$PORT`
riot-web supports these modifications using the `matrix-search` branches on `matrix-js-sdk` and `matrix-react-sdk` and specifying the Search URL using `custom_search_url` in config.json

## To run in a docker container

You'll need to copy `credentials.example` to `credentials` (and replace with
appropriate homeserver url, username and password).

Then you can build and run the docker image like so:

```
$ docker build -t matrix-search .
$ docker run -p 8000:8000 --env-file credentials matrix-search
```
