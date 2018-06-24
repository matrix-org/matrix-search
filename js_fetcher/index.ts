import * as path from "path";

declare var global: {
    Olm: any
    localStorage?: any
    atob: (string) => string;
};

import argv from 'argv';
import get from 'lodash.get';
import * as winston from 'winston';
import {RequestPromise, RequestPromiseOptions} from 'request-promise';
import {RequestAPI, RequiredUriUrl} from 'request';

// import Olm before importing js-sdk to prevent it crying
global.Olm = require('olm');

import {
    Room,
    Event,
    Filter,
    Matrix,
    MatrixEvent,
    UserProfile,
    createClient,
    EventContext,
    MatrixClient,
    IndexedDBStore,
    EventWithContext,
    MatrixInMemoryStore,
    IndexedDBCryptoStore,
    setCryptoStoreFactory,
    WebStorageSessionStore,
} from 'matrix-js-sdk';
// side-effect upgrade MatrixClient prototype
import './matrix_client_ext';

const Queue = require('better-queue');
const SqliteStore = require('better-queue-sqlite');
const request = require('request-promise');

const LocalStorageCryptoStore = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store').default;

argv.option([
    {
        name: 'config',
        type: 'path',
        description: 'Path to the JSON config file',
    }, {
        name: 'data',
        type: 'path',
        description: 'Path to the data directory',
    }, {
        name: 'matrix-search-url',
        type: 'string',
        description: 'The address:port of the matrix-search Go server',
    },
]);
const args = argv.run();

// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)(path.join(args.options['data'], 'js_fetcher.localStorage'));

setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));


const logger = new winston.Logger({
    level: 'info',
    transports: [
        new winston.transports.Console({colorize: true})
    ]
});

class BleveHttp {
    request: RequestAPI<RequestPromise, RequestPromiseOptions, RequiredUriUrl>;

    constructor(baseUrl: string) {
        this.request = request.defaults({baseUrl});
    }

    enqueue(events: Array<Event>) {
        return this.request({
            url: 'enqueue',
            method: 'POST',
            json: true,
            body: events,
        });
    }
}

function indexable(ev: Event): boolean {
    return indexableKeys.some((key: string) => get(ev, key) !== undefined);
}

setup().then();

// debug disable js-sdk log spam
const disableConsoleLogger = false;
if (disableConsoleLogger) {
    console.log = function(){};
    console.warn = function(){};
    console.error = function(){};
    console.error = function(){};
}

const FILTER_BLOCK = {
    not_types: ['*'],
    limit: 0,
};

function onTaskQueued(task_id: string, ev: Event) {
    const {room_id, event_id, sender, type} = ev;
    if (ev.redacts) {
        logger.info('enqueue event for redaction', {room_id, event_id, task_id});
    } else {
        logger.info('enqueue event for indexing', {room_id, event_id, sender, type, task_id});
    }
}

function onBatchFailed(error) {
    logger.error('batch failed', {error});
}

async function setup() {
    let config;
    try {
        config = require(args.options['config'] || 'config.json');
    } catch (e) {
        logger.error('failed to load config', e);
        return;
    }

    const b = new BleveHttp(args.options['matrix-search-url'] || "http://localhost:8000/api/");

    const q = new Queue(async (batch: Array<Event>, cb) => {
        try {
            cb(null, await b.enqueue(batch));
        } catch (e) {
            cb(e);
        }
    }, {
        batchSize: 100,
        maxRetries: 100,
        retryDelay: 5000,
        store: new SqliteStore({
            path: path.join(args.options['data'], 'js_fetcher.queue.sqlite'),
        }),
    });

    q.on('task_queued', onTaskQueued);
    q.on('batch_failed', onBatchFailed);

    const cli: MatrixClient = createClient({
        baseUrl: config['hs_url'],
        idBaseUrl: '',
        userId: config['user_id'],
        deviceId: config['device_id'],
        accessToken: config['access_token'],
        useAuthorizationHeader: true,
        store: new MatrixInMemoryStore({
            localStorage: global.localStorage,
        }),
        sessionStore: new WebStorageSessionStore(global.localStorage),
    });

    cli.on('event', (event: MatrixEvent) => {
        if (event.isEncrypted()) return;

        const cev = event.getClearEvent();
        // if event can be redacted or is a redaction then enqueue it for processing
        if (event.getType() === "m.room.redaction" || !indexable(cev)) return;
        return q.push(cev);
    });
    cli.on('Event.decrypted', (event: MatrixEvent) => {
        if (event.isDecryptionFailure()) {
            logger.warn('decryption failure', {event: event.event});
            return;
        }

        const cev = event.getClearEvent();
        if (!indexable(cev)) return;
        return q.push(cev);
    });

    // cli.on('Room.redaction', (event: MatrixEvent) => {
    //     return q.push({
    //         type: JobType.redact,
    //         event: event.getClearEvent(),
    //     });
    // });

    try {
        logger.info('initializing crypto');
        await cli.initCrypto();
    } catch (error) {
        logger.error('failed to init crypto', {error});
        process.exit(-1);
    }
    logger.info('crypto initialized');

    // create sync filter
    const filter = new Filter(cli.credentials.userId);
    filter.setDefinition({
        room: {
            include_leave: false, // TODO: not sure here
            // ephemeral: FILTER_BLOCK, // we don't care about ephemeral events
            account_data: FILTER_BLOCK, // we don't care about room account_data
            // state: FILTER_BLOCK, // TODO: do we care about state
            timeline: { // TODO do we want all timeline evs
                limit: 20, // grab more events for each room to begin with
            },
        },
        presence: FILTER_BLOCK, // we don't care about presence
        account_data: FILTER_BLOCK, // we don't care about global account_data
    });

    try {
        logger.info('loading/creating sync filter');
        filter.filterId = await cli.getOrCreateFilter(filterName(cli), filter);
    } catch (error) {
        logger.error('failed to getOrCreate sync filter', {error});
        process.exit(-1);
    }
    logger.info('sync filter loaded', {filter_id: filter.getFilterId()});

    logger.info('starting client');
    // filter sync to improve performance
    cli.startClient({
        disablePresence: true,
        filter,
    });
    logger.info('client started - fetcher has begun');
}

// TODO groups-pagination
// TODO backfill
// TODO gapfill

function filterName(cli: MatrixClient): string {
    return `MATRIX_SEARCH_FILTER_${cli.credentials.userId}`;
}

enum RequestKey {
    body = "content.body",
    name = "content.name",
    topic = "content.topic",
}

const indexableKeys = [RequestKey.body, RequestKey.name, RequestKey.topic];
