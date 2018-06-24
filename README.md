# matrix-search

matrix-search will be a Full Text Search engine for Matrix, providing improved query searching, performance and ability to be ran locally, with E2E capabilities.

This project uses `gb`.

# Volatility
This project is in rapid-development so things may change entirely day-to-day. ~~This is not something that is usable yet.~~

# Local Daemon
The project is in a working (not user friendly) state.

Both processes require fs access to a common json config file [`RO`]
and [`RW`] access to a common data directory to write databases to.
For these instructions these will both be in the current working directory
as `config.json` and `data` respectively.

To get started:
0. ensure you have `node` `npm`/`yarn` `go>=1.7` `gb` `git` installed and working.
0. clone this repository, and enter it
0. create a config file, either based on the sample or using the included utility `gen-config` (`gen-config -h` is your friend)
0. build the Go portion by running `gb build`
0. execute the created executable in the background or in another terminal; e.g `./bin/matrix-search-local --config=config.json --data=data &`
0. navigate to the go portion using `pushd js_fetcher`
0. install dependencies using `npm i` or `yarn`
0. navigate back using `popd`
0. run Node script in the background or in another terminal; e.g `node js_fetcher/index.js --config=config.json &`

You will need to run a modified Matrix client which sends `/search` requests to `localhost:8000` or whatever port you specify to Node using `--port=$PORT`
riot-web supports these modifications using the `matrix-search` branches on `matrix-js-sdk` and `matrix-react-sdk` and specifying the Search URL using `custom_search_url` in config.json

## To run in a docker container

You'll need to copy `config.sample.json` to `config.json` (and replace with
appropriate homeserver url, user id, device id and access token or generate
using `gen-config`).

Then you can build and run the docker image like so:

```
$ docker build -t matrix-search .
$ docker run -v data:/node/js_fetcher/data --read-only -v config.json:/node/js_fetcher/config.json -p 8000:8000 matrix-search
```
