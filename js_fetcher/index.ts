declare var global: {
    Olm: any
    localStorage?: any
    atob: (string) => string;
};

import argv from 'argv';
// import cors from 'cors';
import get from 'lodash.get';
import * as winston from 'winston';
import * as mkdirp from 'mkdirp';
// import bodyParser from 'body-parser';
// import express, {Request, Response} from 'express';
import {RequestPromise, RequestPromiseOptions} from 'request-promise';

import {RequestAPI, RequiredUriUrl} from "request";

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
// side-effect upgrade Map and Set prototypes
import './builtin_ext';

const Queue = require('better-queue');
const SqliteStore = require('better-queue-sqlite');
const request = require('request-promise');

const LocalStorageCryptoStore = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store').default;

// create directory which will house the stores.
mkdirp.sync('./store');
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store/localStorage');

setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));

argv.option([
    {
        name: 'url',
        type: 'string',
        description: 'The URL to be used to connect to the Matrix HS',
    }, {
        name: 'username',
        type: 'string',
        description: 'The username to be used to connect to the Matrix HS',
    }, {
        name: 'password',
        type: 'string',
        description: 'The password to be used to connect to the Matrix HS',
    }, {
        name: 'port',
        type: 'int',
        description: 'Port to bind to (default 8000)',
    }
]);

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

    /*
    search(req: BleveRequest) {
        return this.request({
            url: 'query',
            method: 'POST',
            json: true,
            body: req,
        });
    }*/
}

const b = new BleveHttp("http://localhost:8000/api/");

function indexable(ev: Event): boolean {
    return indexableKeys.some((key: string) => get(ev, key) !== undefined);
}

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
        path: './store/queue.sqlite',
    }),
});

q.on('task_queued', function(task_id: string, ev: Event) {
    const {room_id, event_id, sender, type} = ev;
    if (ev.redacts) {
        logger.info('enqueue event for redaction', {room_id, event_id, task_id});
    } else {
        logger.info('enqueue event for indexing', {room_id, event_id, sender, type, task_id});
    }
});

q.on('batch_failed', function(error) {
    logger.error('batch failed', {error});
});

setup().then();

// debug disable js-sdk log spam
const disableConsoleLogger = false;
if (disableConsoleLogger) {
    console.log = function(){};
    console.warn = function(){};
    console.error = function(){};
    console.error = function(){};
}

/*interface GroupValueJSON {
    order: number;
    next_batch?: string;
    results: Array<string>;
}

class GroupValue {
    public order: number;
    public next_batch: string;
    public results: Array<string>;

    constructor(order: number) {
        this.order = order;
        this.next_batch = "";
        this.results = [];
    }

    add(eventId: string) {
        this.results.push(eventId);
    }

    // don't send next_batch if it is empty
    toJSON(): GroupValueJSON {
        const o: GroupValueJSON = {
            order: this.order,
            results: this.results,
        };
        if (this.next_batch) o.next_batch = this.next_batch;
        return o;
    }
}

class Batch {
    public Token: number;
    public Group: string;
    public GroupKey: string;

    constructor(Token: number = 0, Group: string, GroupKey: string) {
        this.Token = Token;
        this.Group = Group;
        this.GroupKey = GroupKey;
    }

    static fromString(from: string): Batch | undefined {
        try {
            const o = JSON.parse(from);
            // const b = new Batch(o);
        } catch (e) {
            return undefined;
        }
    }

    from() {
        return this.Token;
    }

    toString() {
        return JSON.stringify({
            Token: this.Token,
            Group: this.Group,
            GroupKey: this.GroupKey,
        });
    }
}

interface Query {
    must?: Map<string, Set<string>>;
    should?: Map<string, Set<string>>;
    mustNot?: Map<string, Set<string>>;
}

interface BleveRequest {
    keys: Array<string>;
    filter: Query;
    sortBy: SearchOrder;
    searchTerm: string;
    from: number;
    size: number;
}

const pageSize = 10;

interface BleveResponseRow {
    roomId: string;
    eventId: string;
    score: number;
    highlights: Set<string>;
}

interface BleveResponse {
    rows: Array<BleveResponseRow>;
    total: number;
}

interface EventLookupResult {
    event: MatrixEvent;
    score: number;
    state?: Array<MatrixEvent>;
    context?: EventContext;
    highlights: Set<string>;
}

interface Result {
    rank: number;
    result: Event;
    context?: EventContext;
}*/

/*class Search {
    cli: MatrixClient;

    constructor(cli: MatrixClient) {
        this.cli = cli;
    }

    // impedance matching.
    async resolveOne(roomId: string, eventId: string, context?: RequestEventContext): Promise<[Event, EventContext|undefined]> {
        if (context) {
            const limit = Math.max(context.after_limit || 0, context.before_limit || 0, 3);
            const evc = await this.cli.fetchEventContext(roomId, eventId, limit);

            const {start, end, events_before, events_after, state} = evc.context;
            const ctx: EventContext = {
                start,
                end,
                profile_info: new Map<string, UserProfile>(),
                events_before: events_before.map((ev: MatrixEvent) => ev.event),
                events_after: events_after.map((ev: MatrixEvent) => ev.event),
            };

            const users = new Set<string>();
            [...events_before, evc.event, ...events_after].forEach((ev: MatrixEvent) => {
                users.add(ev.getSender());
            });

            state.forEach((ev: Event) => {
                if (ev.type === 'm.room.member' && users.has(ev.state_key))
                    ctx.profile_info.set(ev.state_key, {
                        displayname: ev.content['displayname'],
                        avatar_url: ev.content['avatar_url'],
                    });
            });

            return [evc.event, ctx];
        }

        return [await this.cli.fetchEvent(roomId, eventId), undefined];
    }

    async resolve(rows: Array<BleveResponseRow>, context?: RequestEventContext): Promise<Array<EventLookupResult>> {
        const results: Array<EventLookupResult> = [];

        await Promise.all<void>(rows.map(async (row: BleveResponseRow): Promise<void> => {
            try {
                const [ev, ctx] = await this.resolveOne(row.roomId, row.eventId, context);
                results.push({
                    event: ev,
                    context: ctx,
                    score: row.score,
                    highlights: row.highlights,
                });
            } catch (e) {}
        }));

        return results;
    }*/

    /**
     * @param keys {string} pass straight through to go-bleve
     * @param searchFilter {Filter} compute and send query rules to go-bleve
     * @param sortBy {SearchOrder} pass straight through to go-bleve
     * @param searchTerm {string} pass straight through to go-bleve
     * @param from {number} pass straight through to go-bleve
     * @param context? {RequestEventContext} if defined use to fetch context after go-bleve call
     *//*
    async query(keys: Array<string>, searchFilter: SearchFilter, sortBy: SearchOrder, searchTerm: string, from: number, context?: RequestEventContext): Promise<[Array<EventLookupResult>, number]> {
        const filter: Query = {};

        // initialize fields we will use (we don't use should currently)
        filter.must = new Map();
        filter.mustNot = new Map();

        // must satisfy room_id
        if (searchFilter.rooms.size > 0)
            filter.must.set('room_id', searchFilter.rooms);
        if (searchFilter.notRooms.size > 0)
            filter.mustNot.set('room_id', searchFilter.notRooms);

        // must satisfy sender
        if (searchFilter.senders.size > 0)
            filter.must.set('sender', searchFilter.senders);
        if (searchFilter.notSenders.size > 0)
            filter.mustNot.set('sender', searchFilter.notSenders);

        // must satisfy type
        if (searchFilter.types.size > 0)
            filter.must.set('type', searchFilter.types);
        if (searchFilter.notTypes.size > 0)
            filter.mustNot.set('type', searchFilter.notTypes);

        const r: BleveRequest = {
            from,
            keys,
            filter,
            sortBy,
            searchTerm,
            size: pageSize,
        };

        const resp: BleveResponse = await b.search(r);
        return [await this.resolve(resp.rows, context), resp.total];
    }
}

enum SearchOrder {
    Rank = 'rank',
    Recent = 'recent',
}*/

const FILTER_BLOCK = {
    not_types: ['*'],
    limit: 0,
};

async function setup() {
    const args = argv.run();

    const baseUrl = args.options['url'] || 'https://matrix.org';

    let creds = {
        userId: global.localStorage.getItem('userId'),
        deviceId: global.localStorage.getItem('deviceId'),
        accessToken: global.localStorage.getItem('accessToken'),
    };

    if (!creds.userId || !creds.deviceId || !creds.accessToken) {
        if (!args.options['username'] || !args.options['password']) {
            logger.error('username and password were not specified on the commandline and none were saved');
            argv.help();
            process.exit(-1);
        }

        const loginClient: MatrixClient = createClient({baseUrl});

        try {
            const res = await loginClient.login('m.login.password', {
                user: args.options['username'],
                password: args.options['password'],
                initial_device_display_name: 'Matrix Search Daemon',
            });

            logger.info('logged in', {user_id: res.user_id});
            global.localStorage.setItem('userId', res.user_id);
            global.localStorage.setItem('deviceId', res.device_id);
            global.localStorage.setItem('accessToken', res.access_token);

            creds = {
                userId: res.user_id,
                deviceId: res.device_id,
                accessToken: res.access_token,
            };
        } catch (error) {
            logger.error('an error occurred logging in', {error});
            process.exit(1);
        }
    }

    const cli: MatrixClient = createClient({
        baseUrl,
        idBaseUrl: '',
        ...creds,
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
            ephemeral: FILTER_BLOCK, // we don't care about ephemeral events
            account_data: FILTER_BLOCK, // we don't care about room account_data
            // state: FILTER_BLOCK, // TODO: do we care about state
            // timeline: { // TODO do we want all timeline evs
            //
            // }
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
    logger.info('client started');

    /*
    const app = express();
    app.use(bodyParser.json());
    app.use(cors({
        'allowedHeaders': ['access_token', 'Content-Type'],
        'exposedHeaders': ['access_token'],
        'origin': '*',
        'methods': 'POST',
        'preflightContinue': false
    }));

    app.post('/search', async (req: Request, res: Response) => {
        if (!req.body) {
            res.sendStatus(400);
            return;
        }

        let nextBatch: Batch | null = null;
        if (req.query['next_batch']) {
            try {
                nextBatch = JSON.parse(global.atob(req.query['next_batch']));
                logger.info('found next batch of', {next_batch: nextBatch});
            } catch (error) {
                logger.error('failed to parse next_batch argument', {error});
            }
        }

        // verify that user is allowed to access this thing
        try {
            const castBody: MatrixSearchRequest = req.body;
            const roomCat = castBody.search_categories.room_events;

            if (!roomCat) {
                res.sendStatus(501);
                return;
            }

            let keys: Array<RequestKey> = [RequestKey.body, RequestKey.name, RequestKey.topic]; // default value for roomCat.key
            if (roomCat.keys && roomCat.keys.length) keys = roomCat.keys;

            const includeState = Boolean(roomCat['include_state']);
            const eventContext = roomCat['event_context'];

            let groupByRoomId = false;
            let groupBySender = false;
            if (roomCat.groupings && roomCat.groupings.group_by) {
                roomCat.groupings.group_by.forEach(grouping => {
                    switch (grouping.key) {
                        case RequestGroupKey.roomId:
                            groupByRoomId = true;
                            break;
                        case RequestGroupKey.sender:
                            groupBySender = true;
                            break;
                    }
                });
            }

            const searchFilter = new SearchFilter(roomCat.filter || {}); // default to empty object to assume defaults

            // TODO this is removed because rooms store is unreliable AF
            // const joinedRooms = cli.getRooms();
            // const roomIds = joinedRooms.map((room: Room) => room.roomId);
            //
            // if (roomIds.length < 1) {
            //     res.json({
            //         search_categories: {
            //             room_events: {
            //                 highlights: [],
            //                 results: [],
            //                 count: 0,
            //             },
            //         },
            //     });
            //     return;
            // }

            // SKIP for now
            // let roomIdsSet = searchFilter.filterRooms(roomIds);

            // if (b.isGrouping("room_id")) {
            //     roomIDsSet.Intersect(common.NewStringSet([]string{*b.GroupKey}))
            // }

            // TODO do we need this
            //rankMap := map[string]float64{}
            //allowedEvents := []*Result{}
            // TODO these need changing
            const roomGroups = new Map<string, GroupValue>();
            const senderGroups = new Map<string, GroupValue>();

            let globalNextBatch: string|undefined;

            const rooms = new Set<string>();

            const search = new Search(cli);
            const searchTerm = roomCat['search_term'];

            let allowedEvents: Array<EventLookupResult>;
            let count: number = 0;

            // TODO extend local event map using sqlite/leveldb
            switch (roomCat['order_by']) {
                case 'rank':
                case '':
                    // get messages from Bleve by rank // resolve them locally
                    [allowedEvents, count] = await search.query(keys, searchFilter, SearchOrder.Rank, searchTerm, 0, eventContext);
                    break;

                case 'recent':
                    const from = nextBatch !== null ? nextBatch.from() : 0;
                    [allowedEvents, count] = await search.query(keys, searchFilter, SearchOrder.Recent, searchTerm, from, eventContext);
                    // TODO get next back here
                    break;

                default:
                    res.sendStatus(501);
                    return;
            }

            if (allowedEvents.length < 1) {
                res.json({
                    search_categories: {
                        room_events: {
                            highlights: [],
                            results: [],
                            count: 0,
                        },
                    },
                });
                return;
            }

            const highlightsSuperset = new Set<string>();
            const results: Array<Result> = [];

            allowedEvents.forEach((row: EventLookupResult) => {
                // calculate hightlightsSuperset
                row.highlights.forEach((highlight: string) => {
                    highlightsSuperset.add(highlight);
                });

                const {event: ev} = row;

                if (groupByRoomId) {
                    let v = roomGroups.get(ev.getRoomId());
                    if (!v) v = new GroupValue(row.score);
                    v.add(ev.getId());
                    roomGroups.set(ev.getRoomId(), v);
                }
                if (groupBySender) {
                    let v = senderGroups.get(ev.getSender());
                    if (!v) v = new GroupValue(row.score);
                    v.add(ev.getId());
                    senderGroups.set(ev.getSender(), v);
                }

                rooms.add(ev.getRoomId());

                // add to results array
                if (results.length < searchFilter.limit)
                    results.push({
                        rank: row.score,
                        result: row.event.event,
                        context: row.context,
                    });

            });

            const roomStateMap = new Map<string, Array<MatrixEvent>>();
            if (includeState) {
                // TODO fetch state from server using API because js-sdk is broken due to store
                rooms.forEach((roomId: string) => {
                    const room = cli.getRoom(roomId);
                    if (room) {
                        roomStateMap.set(roomId, room.currentState.reduce((acc, map: Map<string, MatrixEvent>) => {
                            map.forEach((ev: MatrixEvent) => {
                                acc.push(ev);
                            });
                            return acc;
                        }, []));
                    }
                });
            }

            const resp: MatrixSearchResponse = {
                search_categories: {},
            };
            // split to make TypeScript happy with the if statements following
            resp.search_categories.room_events = {
                highlights: highlightsSuperset,
                results,
                count,
            };

            // omitempty behaviour using if to attach onto object to be serialized
            if (globalNextBatch) resp.search_categories.room_events.next_batch = globalNextBatch;
            if (includeState) resp.search_categories.room_events.state = roomStateMap;

            if (groupByRoomId || groupBySender) {
                resp.search_categories.room_events.groups = new Map<string, Map<string, GroupValue>>();

                if (groupByRoomId) {
                    normalizeGroupValueOrder(roomGroups.values());
                    resp.search_categories.room_events.groups.set(RequestGroupKey.roomId, roomGroups);
                }
                if (groupBySender) {
                    normalizeGroupValueOrder(senderGroups.values());
                    resp.search_categories.room_events.groups.set(RequestGroupKey.sender, senderGroups);
                }
            }


            res.status(200);
            res.json(resp);
            return;
        } catch (error) {
            logger.error('catastrophe', {error});
        }

        res.sendStatus(500);
    });

    const port = args.options['port'] || 8000;
    app.listen(port, () => {
        logger.info('we are live', {port});
    });*/
}

// TODO groups-pagination
// TODO backfill

function filterName(cli: MatrixClient): string {
    return `MATRIX_SEARCH_FILTER_${cli.credentials.userId}`;
}

/*
function normalizeGroupValueOrder(it: IterableIterator<GroupValue>) {
    let i = 1;
    Array.from(it).sort((a: GroupValue, b: GroupValue) => a.order-b.order).forEach((g: GroupValue) => {
        // normalize order based on sort by float
        g.order = i++;
    });
}
*/

/*class SearchFilter {
    rooms: Set<string>;
    notRooms: Set<string>;
    senders: Set<string>;
    notSenders: Set<string>;
    types: Set<string>;
    notTypes: Set<string>;
    limit: number;
    containsURL: boolean | undefined;

    constructor(o: object) {
        this.rooms = new Set<string>(o['rooms']);
        this.notRooms = new Set<string>(o['not_rooms']);
        this.senders = new Set<string>(o['senders']);
        this.notSenders = new Set<string>(o['not_senders']);
        this.types = new Set<string>(o['types']);
        this.notTypes = new Set<string>(o['not_types']);

        this.limit = typeof o['limit'] === "number" ? o['limit'] : 10;
        this.containsURL = o['contains_url'];
    }
}*/

/*interface RequestEventContext {
    before_limit?: number;
    after_limit?: number;
    include_profile: boolean;
}*/

/*enum RequestGroupKey {
    roomId = "room_id",
    sender = "sender",
}

interface RequestGroup {
    key: RequestGroupKey;
}

interface RequestGroups {
    group_by?: Array<RequestGroup>;
}*/

enum RequestKey {
    body = "content.body",
    name = "content.name",
    topic = "content.topic",
}

const indexableKeys = [RequestKey.body, RequestKey.name, RequestKey.topic];

/*interface MatrixSearchRequestBody {
    search_term: string;
    keys?: Array<RequestKey>;
    filter?: object; // this gets inflated to an instance of Filter
    order_by?: string;
    event_context?: RequestEventContext;
    includeState?: boolean;
    groupings?: RequestGroups;
}

interface MatrixSearchRequest {
    search_categories: {
        room_events?: MatrixSearchRequestBody;
    }
}

interface MatrixSearchResponse {
    search_categories: {
        room_events?: {
            count: number;
            results: Array<Result>;
            highlights: Set<string>;
            state?: Map<string, Array<Event>>;
            groups?: Map<string, Map<string, GroupValue>>;
            next_batch?: string;
        }
    }
}*/