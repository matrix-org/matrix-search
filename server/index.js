"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const argv_1 = __importDefault(require("argv"));
const cors_1 = __importDefault(require("cors"));
const lodash_get_1 = __importDefault(require("lodash.get"));
const winston = __importStar(require("winston"));
const mkdirp = __importStar(require("mkdirp"));
const body_parser_1 = __importDefault(require("body-parser"));
const express_1 = __importDefault(require("express"));
// import Olm before importing js-sdk to prevent it crying
global.Olm = require('olm');
const matrix_js_sdk_1 = require("matrix-js-sdk");
// side-effect upgrade MatrixClient prototype
require("./matrix_client_ext");
// side-effect upgrade Map and Set prototypes
require("./builtin_ext");
const Queue = require('better-queue');
const SqliteStore = require('better-queue-sqlite');
const request = require('request-promise');
const LocalStorageCryptoStore = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store').default;
// create directory which will house the stores.
mkdirp.sync('./store');
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store/localStorage');
matrix_js_sdk_1.setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));
argv_1.default.option([
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
        new winston.transports.Console({ colorize: true })
    ]
});
class BleveHttp {
    constructor(baseUrl) {
        this.request = request.defaults({ baseUrl });
    }
    enqueue(events) {
        return this.request({
            url: 'enqueue',
            method: 'POST',
            json: true,
            body: events,
        });
    }
    search(req) {
        return this.request({
            url: 'query',
            method: 'POST',
            json: true,
            body: req,
        });
    }
}
const b = new BleveHttp("http://localhost:9999/api/");
function indexable(ev) {
    return indexableKeys.some((key) => lodash_get_1.default(ev, key) !== undefined);
}
const q = new Queue(async (batch, cb) => {
    try {
        cb(null, await b.enqueue(batch));
    }
    catch (e) {
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
q.on('task_queued', function (task_id, ev) {
    const { room_id, event_id, sender, type } = ev;
    if (ev.redacts) {
        logger.info('enqueue event for redaction', { room_id, event_id, task_id });
    }
    else {
        logger.info('enqueue event for indexing', { room_id, event_id, sender, type, task_id });
    }
});
q.on('batch_failed', function (error) {
    logger.error('batch failed', { error });
});
setup().then();
// debug disable js-sdk log spam
const disableConsoleLogger = false;
if (disableConsoleLogger) {
    console.log = function () { };
    console.warn = function () { };
    console.error = function () { };
    console.error = function () { };
}
class GroupValue {
    constructor(order) {
        this.order = order;
        this.next_batch = "";
        this.results = [];
    }
    add(eventId) {
        this.results.push(eventId);
    }
    // don't send next_batch if it is empty
    toJSON() {
        const o = {
            order: this.order,
            results: this.results,
        };
        if (this.next_batch)
            o.next_batch = this.next_batch;
        return o;
    }
}
class Batch {
    constructor(Token = 0, Group, GroupKey) {
        this.Token = Token;
        this.Group = Group;
        this.GroupKey = GroupKey;
    }
    static fromString(from) {
        try {
            const o = JSON.parse(from);
            // const b = new Batch(o);
        }
        catch (e) {
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
const pageSize = 10;
class Search {
    constructor(cli) {
        this.cli = cli;
    }
    // impedance matching.
    async resolveOne(roomId, eventId, context) {
        if (context) {
            const limit = Math.max(context.after_limit || 0, context.before_limit || 0, 3);
            const evc = await this.cli.fetchEventContext(roomId, eventId, limit);
            const { start, end, events_before, events_after, state } = evc.context;
            const ctx = {
                start,
                end,
                profile_info: new Map(),
                events_before: events_before.map((ev) => ev.event),
                events_after: events_after.map((ev) => ev.event),
            };
            const users = new Set();
            [...events_before, evc.event, ...events_after].forEach((ev) => {
                users.add(ev.getSender());
            });
            state.forEach((ev) => {
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
    async resolve(rows, context) {
        const results = [];
        await Promise.all(rows.map(async (row) => {
            try {
                const [ev, ctx] = await this.resolveOne(row.roomId, row.eventId, context);
                results.push({
                    event: ev,
                    context: ctx,
                    score: row.score,
                    highlights: row.highlights,
                });
            }
            catch (e) { }
        }));
        return results;
    }
    /**
     * @param keys {string} pass straight through to go-bleve
     * @param searchFilter {Filter} compute and send query rules to go-bleve
     * @param sortBy {SearchOrder} pass straight through to go-bleve
     * @param searchTerm {string} pass straight through to go-bleve
     * @param from {number} pass straight through to go-bleve
     * @param context? {RequestEventContext} if defined use to fetch context after go-bleve call
     */
    async query(keys, searchFilter, sortBy, searchTerm, from, context) {
        const filter = {};
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
        const r = {
            from,
            keys,
            filter,
            sortBy,
            searchTerm,
            size: pageSize,
        };
        const resp = await b.search(r);
        return [await this.resolve(resp.rows, context), resp.total];
    }
}
var SearchOrder;
(function (SearchOrder) {
    SearchOrder["Rank"] = "rank";
    SearchOrder["Recent"] = "recent";
})(SearchOrder || (SearchOrder = {}));
async function setup() {
    const args = argv_1.default.run();
    const baseUrl = args.options['url'] || 'https://matrix.org';
    let creds = {
        userId: global.localStorage.getItem('userId'),
        deviceId: global.localStorage.getItem('deviceId'),
        accessToken: global.localStorage.getItem('accessToken'),
    };
    if (!creds.userId || !creds.deviceId || !creds.accessToken) {
        if (!args.options['username'] || !args.options['password']) {
            logger.error('username and password were not specified on the commandline and none were saved');
            argv_1.default.help();
            process.exit(-1);
        }
        const loginClient = matrix_js_sdk_1.createClient({ baseUrl });
        try {
            const res = await loginClient.login('m.login.password', {
                user: args.options['username'],
                password: args.options['password'],
                initial_device_display_name: 'Matrix Search Daemon',
            });
            logger.info('logged in', { user_id: res.user_id });
            global.localStorage.setItem('userId', res.user_id);
            global.localStorage.setItem('deviceId', res.device_id);
            global.localStorage.setItem('accessToken', res.access_token);
            creds = {
                userId: res.user_id,
                deviceId: res.device_id,
                accessToken: res.access_token,
            };
        }
        catch (error) {
            logger.error('an error occurred logging in', { error });
            process.exit(1);
        }
    }
    const cli = matrix_js_sdk_1.createClient(Object.assign({ baseUrl, idBaseUrl: '' }, creds, { useAuthorizationHeader: true, store: new matrix_js_sdk_1.MatrixInMemoryStore({
            localStorage: global.localStorage,
        }), sessionStore: new matrix_js_sdk_1.WebStorageSessionStore(global.localStorage) }));
    cli.on('event', (event) => {
        if (event.isEncrypted())
            return;
        const cev = event.getClearEvent();
        // if event can be redacted or is a redaction then enqueue it for processing
        if (event.getType() === "m.room.redaction" || !indexable(cev))
            return;
        return q.push(cev);
    });
    cli.on('Event.decrypted', (event) => {
        if (event.isDecryptionFailure()) {
            logger.warn('decryption failure', { event: event.event });
            return;
        }
        const cev = event.getClearEvent();
        if (!indexable(cev))
            return;
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
    }
    catch (error) {
        logger.error('failed to init crypto', { error });
        process.exit(-1);
    }
    logger.info('crypto initialized');
    // create sync filter
    const filter = new matrix_js_sdk_1.Filter(cli.credentials.userId);
    filter.setDefinition({
        room: {
            include_leave: false,
            ephemeral: {
                limit: 0,
                types: [],
            },
            account_data: {
                limit: 0,
                types: [],
            },
        },
        presence: {
            limit: 0,
            types: [],
        },
        account_data: {
            limit: 0,
            types: [],
        },
    });
    try {
        logger.info('loading/creating sync filter');
        filter.filterId = await cli.getOrCreateFilter(filterName(cli), filter);
    }
    catch (error) {
        logger.error('failed to getOrCreate sync filter', { error });
        process.exit(-1);
    }
    logger.info('sync filter loaded', { filter_id: filter.getFilterId() });
    logger.info('starting client');
    // filter sync to improve performance
    cli.startClient({
        disablePresence: true,
        filter,
    });
    logger.info('client started');
    const app = express_1.default();
    app.use(body_parser_1.default.json());
    app.use(cors_1.default({
        'allowedHeaders': ['access_token', 'Content-Type'],
        'exposedHeaders': ['access_token'],
        'origin': '*',
        'methods': 'POST',
        'preflightContinue': false
    }));
    app.post('/search', async (req, res) => {
        if (!req.body) {
            res.sendStatus(400);
            return;
        }
        let nextBatch = null;
        if (req.query['next_batch']) {
            try {
                nextBatch = JSON.parse(global.atob(req.query['next_batch']));
                logger.info('found next batch of', { next_batch: nextBatch });
            }
            catch (error) {
                logger.error('failed to parse next_batch argument', { error });
            }
        }
        // verify that user is allowed to access this thing
        try {
            const castBody = req.body;
            const roomCat = castBody.search_categories.room_events;
            if (!roomCat) {
                res.sendStatus(501);
                return;
            }
            let keys = [RequestKey.body, RequestKey.name, RequestKey.topic]; // default value for roomCat.key
            if (roomCat.keys && roomCat.keys.length)
                keys = roomCat.keys;
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
            const roomGroups = new Map();
            const senderGroups = new Map();
            let globalNextBatch;
            const rooms = new Set();
            const search = new Search(cli);
            const searchTerm = roomCat['search_term'];
            let allowedEvents;
            let count = 0;
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
            const highlightsSuperset = new Set();
            const results = [];
            allowedEvents.forEach((row) => {
                // calculate hightlightsSuperset
                row.highlights.forEach((highlight) => {
                    highlightsSuperset.add(highlight);
                });
                const { event: ev } = row;
                if (groupByRoomId) {
                    let v = roomGroups.get(ev.getRoomId());
                    if (!v)
                        v = new GroupValue(row.score);
                    v.add(ev.getId());
                    roomGroups.set(ev.getRoomId(), v);
                }
                if (groupBySender) {
                    let v = senderGroups.get(ev.getSender());
                    if (!v)
                        v = new GroupValue(row.score);
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
            const roomStateMap = new Map();
            if (includeState) {
                // TODO fetch state from server using API because js-sdk is broken due to store
                rooms.forEach((roomId) => {
                    const room = cli.getRoom(roomId);
                    if (room) {
                        roomStateMap.set(roomId, room.currentState.reduce((acc, map) => {
                            map.forEach((ev) => {
                                acc.push(ev);
                            });
                            return acc;
                        }, []));
                    }
                });
            }
            const resp = {
                search_categories: {},
            };
            // split to make TypeScript happy with the if statements following
            resp.search_categories.room_events = {
                highlights: highlightsSuperset,
                results,
                count,
            };
            // omitempty behaviour using if to attach onto object to be serialized
            if (globalNextBatch)
                resp.search_categories.room_events.next_batch = globalNextBatch;
            if (includeState)
                resp.search_categories.room_events.state = roomStateMap;
            if (groupByRoomId || groupBySender) {
                resp.search_categories.room_events.groups = new Map();
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
        }
        catch (error) {
            logger.error('catastrophe', { error });
        }
        res.sendStatus(500);
    });
    const port = args.options['port'] || 8000;
    app.listen(port, () => {
        logger.info('we are live', { port });
    });
}
// TODO pagination
// TODO groups-pagination
// TODO backfill
function filterName(cli) {
    return `MATRIX_SEARCH_FILTER_${cli.credentials.userId}`;
}
function normalizeGroupValueOrder(it) {
    let i = 1;
    Array.from(it).sort((a, b) => a.order - b.order).forEach((g) => {
        // normalize order based on sort by float
        g.order = i++;
    });
}
class SearchFilter {
    constructor(o) {
        this.rooms = new Set(o['rooms']);
        this.notRooms = new Set(o['not_rooms']);
        this.senders = new Set(o['senders']);
        this.notSenders = new Set(o['not_senders']);
        this.types = new Set(o['types']);
        this.notTypes = new Set(o['not_types']);
        this.limit = typeof o['limit'] === "number" ? o['limit'] : 10;
        this.containsURL = o['contains_url'];
    }
}
var RequestGroupKey;
(function (RequestGroupKey) {
    RequestGroupKey["roomId"] = "room_id";
    RequestGroupKey["sender"] = "sender";
})(RequestGroupKey || (RequestGroupKey = {}));
var RequestKey;
(function (RequestKey) {
    RequestKey["body"] = "content.body";
    RequestKey["name"] = "content.name";
    RequestKey["topic"] = "content.topic";
})(RequestKey || (RequestKey = {}));
const indexableKeys = [RequestKey.body, RequestKey.name, RequestKey.topic];
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFNQSxnREFBd0I7QUFDeEIsZ0RBQXdCO0FBQ3hCLDREQUE2QjtBQUM3QixpREFBbUM7QUFDbkMsK0NBQWlDO0FBQ2pDLDhEQUFxQztBQUNyQyxzREFBbUQ7QUFLbkQsMERBQTBEO0FBQzFELE1BQU0sQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBRTVCLGlEQWdCdUI7QUFDdkIsNkNBQTZDO0FBQzdDLCtCQUE2QjtBQUM3Qiw2Q0FBNkM7QUFDN0MseUJBQXVCO0FBRXZCLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUN0QyxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUNuRCxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUUzQyxNQUFNLHVCQUF1QixHQUFHLE9BQU8sQ0FBQywwREFBMEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQztBQUU1RyxnREFBZ0Q7QUFDaEQsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN2Qiw4QkFBOEI7QUFDOUIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxZQUFZLEtBQUssV0FBVyxJQUFJLE1BQU0sQ0FBQyxZQUFZLEtBQUssSUFBSTtJQUMxRSxNQUFNLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBRWxHLHFDQUFxQixDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksdUJBQXVCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFFOUUsY0FBSSxDQUFDLE1BQU0sQ0FBQztJQUNSO1FBQ0ksSUFBSSxFQUFFLEtBQUs7UUFDWCxJQUFJ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QUFPLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQzlELElBQUksQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7Q0FDSjtBQVFELElBQUssZUFHSjtBQUhELFdBQUssZUFBZTtJQUNoQixxQ0FBa0IsQ0FBQTtJQUNsQixvQ0FBaUIsQ0FBQTtBQUNyQixDQUFDLEVBSEksZUFBZSxLQUFmLGVBQWUsUUFHbkI7QUFVRCxJQUFLLFVBSUo7QUFKRCxXQUFLLFVBQVU7SUFDWCxtQ0FBcUIsQ0FBQTtJQUNyQixtQ0FBcUIsQ0FBQTtJQUNyQixxQ0FBdUIsQ0FBQTtBQUMzQixDQUFDLEVBSkksVUFBVSxLQUFWLFVBQVUsUUFJZDtBQUVELE1BQU0sYUFBYSxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImRlY2xhcmUgdmFyIGdsb2JhbDoge1xuICAgIE9sbTogYW55XG4gICAgbG9jYWxTdG9yYWdlPzogYW55XG4gICAgYXRvYjogKHN0cmluZykgPT4gc3RyaW5nO1xufTtcblxuaW1wb3J0IGFyZ3YgZnJvbSAnYXJndic7XG5pbXBvcnQgY29ycyBmcm9tICdjb3JzJztcbmltcG9ydCBnZXQgZnJvbSAnbG9kYXNoLmdldCc7XG5pbXBvcnQgKiBhcyB3aW5zdG9uIGZyb20gJ3dpbnN0b24nO1xuaW1wb3J0ICogYXMgbWtkaXJwIGZyb20gJ21rZGlycCc7XG5pbXBvcnQgYm9keVBhcnNlciBmcm9tICdib2R5LXBhcnNlcic7XG5pbXBvcnQgZXhwcmVzcywge1JlcXVlc3QsIFJlc3BvbnNlfSBmcm9tICdleHByZXNzJztcbmltcG9ydCB7UmVxdWVzdFByb21pc2UsIFJlcXVlc3RQcm9taXNlT3B0aW9uc30gZnJvbSAncmVxdWVzdC1wcm9taXNlJztcblxuaW1wb3J0IHtSZXF1ZXN0QVBJLCBSZXF1aXJlZFVyaVVybH0gZnJvbSBcInJlcXVlc3RcIjtcblxuLy8gaW1wb3J0IE9sbSBiZWZvcmUgaW1wb3J0aW5nIGpzLXNkayB0byBwcmV2ZW50IGl0IGNyeWluZ1xuZ2xvYmFsLk9sbSA9IHJlcXVpcmUoJ29sbScpO1xuXG5pbXBvcnQge1xuICAgIFJvb20sXG4gICAgRXZlbnQsXG4gICAgRmlsdGVyLFxuICAgIE1hdHJpeCxcbiAgICBNYXRyaXhFdmVudCxcbiAgICBVc2VyUHJvZmlsZSxcbiAgICBjcmVhdGVDbGllbnQsXG4gICAgRXZlbnRDb250ZXh0LFxuICAgIE1hdHJpeENsaWVudCxcbiAgICBJbmRleGVkREJTdG9yZSxcbiAgICBFdmVudFdpdGhDb250ZXh0LFxuICAgIE1hdHJpeEluTWVtb3J5U3RvcmUsXG4gICAgSW5kZXhlZERCQ3J5cHRvU3RvcmUsXG4gICAgc2V0Q3J5cHRvU3RvcmVGYWN0b3J5LFxuICAgIFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUsXG59IGZyb20gJ21hdHJpeC1qcy1zZGsnO1xuLy8gc2lkZS1lZmZlY3QgdXBncmFkZSBNYXRyaXhDbGllbnQgcHJvdG90eXBlXG5pbXBvcnQgJy4vbWF0cml4X2NsaWVudF9leHQnO1xuLy8gc2lkZS1lZmZlY3QgdXBncmFkZSBNYXAgYW5kIFNldCBwcm90b3R5cGVzXG5pbXBvcnQgJy4vYnVpbHRpbl9leHQnO1xuXG5jb25zdCBRdWV1ZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZScpO1xuY29uc3QgU3FsaXRlU3RvcmUgPSByZXF1aXJlKCdiZXR0ZXItcXVldWUtc3FsaXRlJyk7XG5jb25zdCByZXF1ZXN0ID0gcmVxdWlyZSgncmVxdWVzdC1wcm9taXNlJyk7XG5cbmNvbnN0IExvY2FsU3RvcmFnZUNyeXB0b1N0b3JlID0gcmVxdWlyZSgnbWF0cml4LWpzLXNkay9saWIvY3J5cHRvL3N0b3JlL2xvY2FsU3RvcmFnZS1jcnlwdG8tc3RvcmUnKS5kZWZhdWx0O1xuXG4vLyBjcmVhdGUgZGlyZWN0b3J5IHdoaWNoIHdpbGwgaG91c2UgdGhlIHN0b3Jlcy5cbm1rZGlycC5zeW5jKCcuL3N0b3JlJyk7XG4vLyBMb2FkaW5nIGxvY2FsU3RvcmFnZSBtb2R1bGVcbmlmICh0eXBlb2YgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9PT0gXCJ1bmRlZmluZWRcIiB8fCBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBudWxsKVxuICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2UgPSBuZXcgKHJlcXVpcmUoJ25vZGUtbG9jYWxzdG9yYWdlJykuTG9jYWxTdG9yYWdlKSgnLi9zdG9yZS9sb2NhbFN0b3JhZ2UnKTtcblxuc2V0Q3J5cHRvU3RvcmVGYWN0b3J5KCgpID0+IG5ldyBMb2NhbFN0b3JhZ2VDcnlwdG9TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSk7XG5cbmFyZ3Yub3B0aW9uKFtcbiAgICB7XG4gICAgICAgIG5hbWU6ICd1cmwnLFxuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdUaGUgVVJMIHRvIGJlIHVzZWQgdG8gY29ubmVjdCB0byB0aGUgTWF0cml4IEhTJyxcbiAgICB9LCB7XG4gICAgICAgIG5hbWU6ICd1c2VybmFtZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSB1c2VybmFtZSB0byBiZSB1c2VkIHRvIGNvbm5lY3QgdG8gdGhlIE1hdHJpeCBIUycsXG4gICAgfSwge1xuICAgICAgICBuYW1lOiAncGFzc3dvcmQnLFxuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdUaGUgcGFzc3dvcmQgdG8gYmUgdXNlZCB0byBjb25uZWN0IHRvIHRoZSBNYXRyaXggSFMnLFxuICAgIH0sIHtcbiAgICAgICAgbmFtZTogJ3BvcnQnLFxuICAgICAgICB0eXBlOiAnaW50JyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdQb3J0IHRvIGJpbmQgdG8gKGRlZmF1bHQgODAwMCknLFxuICAgIH1cbl0pO1xuXG5jb25zdCBsb2dnZXIgPSBuZXcgd2luc3Rvbi5Mb2dnZXIoe1xuICAgIGxldmVsOiAnaW5mbycsXG4gICAgdHJhbnNwb3J0czogW1xuICAgICAgICBuZXcgd2luc3Rvbi50cmFuc3BvcnRzLkNvbnNvbGUoe2NvbG9yaXplOiB0cnVlfSlcbiAgICBdXG59KTtcblxuY2xhc3MgQmxldmVIdHRwIHtcbiAgICByZXF1ZXN0OiBSZXF1ZXN0QVBJPFJlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnMsIFJlcXVpcmVkVXJpVXJsPjtcblxuICAgIGNvbnN0cnVjdG9yKGJhc2VVcmw6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlcXVlc3QgPSByZXF1ZXN0LmRlZmF1bHRzKHtiYXNlVXJsfSk7XG4gICAgfVxuXG4gICAgZW5xdWV1ZShldmVudHM6IEFycmF5PEV2ZW50Pikge1xuICAgICAgICByZXR1cm4gdGhpcy5yZXF1ZXN0KHtcbiAgICAgICAgICAgIHVybDogJ2VucXVldWUnLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogZXZlbnRzLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBzZWFyY2gocmVxOiBCbGV2ZVJlcXVlc3QpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdxdWVyeScsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGpzb246IHRydWUsXG4gICAgICAgICAgICBib2R5OiByZXEsXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuY29uc3QgYiA9IG5ldyBCbGV2ZUh0dHAoXCJodHRwOi8vbG9jYWxob3N0Ojk5OTkvYXBpL1wiKTtcblxuZnVuY3Rpb24gaW5kZXhhYmxlKGV2OiBFdmVudCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbmRleGFibGVLZXlzLnNvbWUoKGtleTogc3RyaW5nKSA9PiBnZXQoZXYsIGtleSkgIT09IHVuZGVmaW5lZCk7XG59XG5cbmNvbnN0IHEgPSBuZXcgUXVldWUoYXN5bmMgKGJhdGNoOiBBcnJheTxFdmVudD4sIGNiKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY2IobnVsbCwgYXdhaXQgYi5lbnF1ZXVlKGJhdGNoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYihlKTtcbiAgICB9XG59LCB7XG4gICAgYmF0Y2hTaXplOiAxMDAsXG4gICAgbWF4UmV0cmllczogMTAwLFxuICAgIHJldHJ5RGVsYXk6IDUwMDAsXG4gICAgc3RvcmU6IG5ldyBTcWxpdGVTdG9yZSh7XG4gICAgICAgIHBhdGg6ICcuL3N0b3JlL3F1ZXVlLnNxbGl0ZScsXG4gICAgfSksXG59KTtcblxucS5vbigndGFza19xdWV1ZWQnLCBmdW5jdGlvbih0YXNrX2lkOiBzdHJpbmcsIGV2OiBFdmVudCkge1xuICAgIGNvbnN0IHtyb29tX2lkLCBldmVudF9pZCwgc2VuZGVyLCB0eXBlfSA9IGV2O1xuICAgIGlmIChldi5yZWRhY3RzKSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdlbnF1ZXVlIGV2ZW50IGZvciByZWRhY3Rpb24nLCB7cm9vbV9pZCwgZXZlbnRfaWQsIHRhc2tfaWR9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuaW5mbygnZW5xdWV1ZSBldmVudCBmb3IgaW5kZXhpbmcnLCB7cm9vbV9pZCwgZXZlbnRfaWQsIHNlbmRlciwgdHlwZSwgdGFza19pZH0pO1xuICAgIH1cbn0pO1xuXG5xLm9uKCdiYXRjaF9mYWlsZWQnLCBmdW5jdGlvbihlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignYmF0Y2ggZmFpbGVkJywge2Vycm9yfSk7XG59KTtcblxuc2V0dXAoKS50aGVuKCk7XG5cbi8vIGRlYnVnIGRpc2FibGUganMtc2RrIGxvZyBzcGFtXG5jb25zdCBkaXNhYmxlQ29uc29sZUxvZ2dlciA9IGZhbHNlO1xuaWYgKGRpc2FibGVDb25zb2xlTG9nZ2VyKSB7XG4gICAgY29uc29sZS5sb2cgPSBmdW5jdGlvbigpe307XG4gICAgY29uc29sZS53YXJuID0gZnVuY3Rpb24oKXt9O1xuICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbigpe307XG4gICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKCl7fTtcbn1cblxuaW50ZXJmYWNlIEdyb3VwVmFsdWVKU09OIHtcbiAgICBvcmRlcjogbnVtYmVyO1xuICAgIG5leHRfYmF0Y2g/OiBzdHJpbmc7XG4gICAgcmVzdWx0czogQXJyYXk8c3RyaW5nPjtcbn1cblxuY2xhc3MgR3JvdXBWYWx1ZSB7XG4gICAgcHVibGljIG9yZGVyOiBudW1iZXI7XG4gICAgcHVibGljIG5leHRfYmF0Y2g6IHN0cmluZztcbiAgICBwdWJsaWMgcmVzdWx0czogQXJyYXk8c3RyaW5nPjtcblxuICAgIGNvbnN0cnVjdG9yKG9yZGVyOiBudW1iZXIpIHtcbiAgICAgICAgdGhpcy5vcmRlciA9IG9yZGVyO1xuICAgICAgICB0aGlzLm5leHRfYmF0Y2ggPSBcIlwiO1xuICAgICAgICB0aGlzLnJlc3VsdHMgPSBbXTtcbiAgICB9XG5cbiAgICBhZGQoZXZlbnRJZDogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMucmVzdWx0cy5wdXNoKGV2ZW50SWQpO1xuICAgIH1cblxuICAgIC8vIGRvbid0IHNlbmQgbmV4dF9iYXRjaCBpZiBpdCBpcyBlbXB0eVxuICAgIHRvSlNPTigpOiBHcm91cFZhbHVlSlNPTiB7XG4gICAgICAgIGNvbnN0IG86IEdyb3VwVmFsdWVKU09OID0ge1xuICAgICAgICAgICAgb3JkZXI6IHRoaXMub3JkZXIsXG4gICAgICAgICAgICByZXN1bHRzOiB0aGlzLnJlc3VsdHMsXG4gICAgICAgIH07XG4gICAgICAgIGlmICh0aGlzLm5leHRfYmF0Y2gpIG8ubmV4dF9iYXRjaCA9IHRoaXMubmV4dF9iYXRjaDtcbiAgICAgICAgcmV0dXJuIG87XG4gICAgfVxufVxuXG5jbGFzcyBCYXRjaCB7XG4gICAgcHVibGljIFRva2VuOiBudW1iZXI7XG4gICAgcHVibGljIEdyb3VwOiBzdHJpbmc7XG4gICAgcHVibGljIEdyb3VwS2V5OiBzdHJpbmc7XG5cbiAgICBjb25zdHJ1Y3RvcihUb2tlbjogbnVtYmVyID0gMCwgR3JvdXA6IHN0cmluZywgR3JvdXBLZXk6IHN0cmluZykge1xuICAgICAgICB0aGlzLlRva2VuID0gVG9rZW47XG4gICAgICAgIHRoaXMuR3JvdXAgPSBHcm91cDtcbiAgICAgICAgdGhpcy5Hcm91cEtleSA9IEdyb3VwS2V5O1xuICAgIH1cblxuICAgIHN0YXRpYyBmcm9tU3RyaW5nKGZyb206IHN0cmluZyk6IEJhdGNoIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG8gPSBKU09OLnBhcnNlKGZyb20pO1xuICAgICAgICAgICAgLy8gY29uc3QgYiA9IG5ldyBCYXRjaChvKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZyb20oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlRva2VuO1xuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgVG9rZW46IHRoaXMuVG9rZW4sXG4gICAgICAgICAgICBHcm91cDogdGhpcy5Hcm91cCxcbiAgICAgICAgICAgIEdyb3VwS2V5OiB0aGlzLkdyb3VwS2V5LFxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBRdWVyeSB7XG4gICAgbXVzdD86IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PjtcbiAgICBzaG91bGQ/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gICAgbXVzdE5vdD86IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+Pjtcbn1cblxuaW50ZXJmYWNlIEJsZXZlUmVxdWVzdCB7XG4gICAga2V5czogQXJyYXk8c3RyaW5nPjtcbiAgICBmaWx0ZXI6IFF1ZXJ5O1xuICAgIHNvcnRCeTogU2VhcmNoT3JkZXI7XG4gICAgc2VhcmNoVGVybTogc3RyaW5nO1xuICAgIGZyb206IG51bWJlcjtcbiAgICBzaXplOiBudW1iZXI7XG59XG5cbmNvbnN0IHBhZ2VTaXplID0gMTA7XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlUm93IHtcbiAgICByb29tSWQ6IHN0cmluZztcbiAgICBldmVudElkOiBzdHJpbmc7XG4gICAgc2NvcmU6IG51bWJlcjtcbiAgICBoaWdobGlnaHRzOiBTZXQ8c3RyaW5nPjtcbn1cblxuaW50ZXJmYWNlIEJsZXZlUmVzcG9uc2Uge1xuICAgIHJvd3M6IEFycmF5PEJsZXZlUmVzcG9uc2VSb3c+O1xuICAgIHRvdGFsOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBFdmVudExvb2t1cFJlc3VsdCB7XG4gICAgZXZlbnQ6IE1hdHJpeEV2ZW50O1xuICAgIHNjb3JlOiBudW1iZXI7XG4gICAgc3RhdGU/OiBBcnJheTxNYXRyaXhFdmVudD47XG4gICAgY29udGV4dD86IEV2ZW50Q29udGV4dDtcbiAgICBoaWdobGlnaHRzOiBTZXQ8c3RyaW5nPjtcbn1cblxuaW50ZXJmYWNlIFJlc3VsdCB7XG4gICAgcmFuazogbnVtYmVyO1xuICAgIHJlc3VsdDogRXZlbnQ7XG4gICAgY29udGV4dD86IEV2ZW50Q29udGV4dDtcbn1cblxuY2xhc3MgU2VhcmNoIHtcbiAgICBjbGk6IE1hdHJpeENsaWVudDtcblxuICAgIGNvbnN0cnVjdG9yKGNsaTogTWF0cml4Q2xpZW50KSB7XG4gICAgICAgIHRoaXMuY2xpID0gY2xpO1xuICAgIH1cblxuICAgIC8vIGltcGVkYW5jZSBtYXRjaGluZy5cbiAgICBhc3luYyByZXNvbHZlT25lKHJvb21JZDogc3RyaW5nLCBldmVudElkOiBzdHJpbmcsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbRXZlbnQsIEV2ZW50Q29udGV4dHx1bmRlZmluZWRdPiB7XG4gICAgICAgIGlmIChjb250ZXh0KSB7XG4gICAgICAgICAgICBjb25zdCBsaW1pdCA9IE1hdGgubWF4KGNvbnRleHQuYWZ0ZXJfbGltaXQgfHwgMCwgY29udGV4dC5iZWZvcmVfbGltaXQgfHwgMCwgMyk7XG4gICAgICAgICAgICBjb25zdCBldmMgPSBhd2FpdCB0aGlzLmNsaS5mZXRjaEV2ZW50Q29udGV4dChyb29tSWQsIGV2ZW50SWQsIGxpbWl0KTtcblxuICAgICAgICAgICAgY29uc3Qge3N0YXJ0LCBlbmQsIGV2ZW50c19iZWZvcmUsIGV2ZW50c19hZnRlciwgc3RhdGV9ID0gZXZjLmNvbnRleHQ7XG4gICAgICAgICAgICBjb25zdCBjdHg6IEV2ZW50Q29udGV4dCA9IHtcbiAgICAgICAgICAgICAgICBzdGFydCxcbiAgICAgICAgICAgICAgICBlbmQsXG4gICAgICAgICAgICAgICAgcHJvZmlsZV9pbmZvOiBuZXcgTWFwPHN0cmluZywgVXNlclByb2ZpbGU+KCksXG4gICAgICAgICAgICAgICAgZXZlbnRzX2JlZm9yZTogZXZlbnRzX2JlZm9yZS5tYXAoKGV2OiBNYXRyaXhFdmVudCkgPT4gZXYuZXZlbnQpLFxuICAgICAgICAgICAgICAgIGV2ZW50c19hZnRlcjogZXZlbnRzX2FmdGVyLm1hcCgoZXY6IE1hdHJpeEV2ZW50KSA9PiBldi5ldmVudCksXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCB1c2VycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICAgICAgWy4uLmV2ZW50c19iZWZvcmUsIGV2Yy5ldmVudCwgLi4uZXZlbnRzX2FmdGVyXS5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICB1c2Vycy5hZGQoZXYuZ2V0U2VuZGVyKCkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHN0YXRlLmZvckVhY2goKGV2OiBFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChldi50eXBlID09PSAnbS5yb29tLm1lbWJlcicgJiYgdXNlcnMuaGFzKGV2LnN0YXRlX2tleSkpXG4gICAgICAgICAgICAgICAgICAgIGN0eC5wcm9maWxlX2luZm8uc2V0KGV2LnN0YXRlX2tleSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGxheW5hbWU6IGV2LmNvbnRlbnRbJ2Rpc3BsYXluYW1lJ10sXG4gICAgICAgICAgICAgICAgICAgICAgICBhdmF0YXJfdXJsOiBldi5jb250ZW50WydhdmF0YXJfdXJsJ10sXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiBbZXZjLmV2ZW50LCBjdHhdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLmNsaS5mZXRjaEV2ZW50KHJvb21JZCwgZXZlbnRJZCksIHVuZGVmaW5lZF07XG4gICAgfVxuXG4gICAgYXN5bmMgcmVzb2x2ZShyb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PiwgY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQpOiBQcm9taXNlPEFycmF5PEV2ZW50TG9va3VwUmVzdWx0Pj4ge1xuICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTxFdmVudExvb2t1cFJlc3VsdD4gPSBbXTtcblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbDx2b2lkPihyb3dzLm1hcChhc3luYyAocm93OiBCbGV2ZVJlc3BvbnNlUm93KTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtldiwgY3R4XSA9IGF3YWl0IHRoaXMucmVzb2x2ZU9uZShyb3cucm9vbUlkLCByb3cuZXZlbnRJZCwgY29udGV4dCk7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQ6IGV2LFxuICAgICAgICAgICAgICAgICAgICBjb250ZXh0OiBjdHgsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiByb3cuc2NvcmUsXG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IHJvdy5oaWdobGlnaHRzLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge31cbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBwYXJhbSBrZXlzIHtzdHJpbmd9IHBhc3Mgc3RyYWlnaHQgdGhyb3VnaCB0byBnby1ibGV2ZVxuICAgICAqIEBwYXJhbSBzZWFyY2hGaWx0ZXIge0ZpbHRlcn0gY29tcHV0ZSBhbmQgc2VuZCBxdWVyeSBydWxlcyB0byBnby1ibGV2ZVxuICAgICAqIEBwYXJhbSBzb3J0Qnkge1NlYXJjaE9yZGVyfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc2VhcmNoVGVybSB7c3RyaW5nfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gZnJvbSB7bnVtYmVyfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gY29udGV4dD8ge1JlcXVlc3RFdmVudENvbnRleHR9IGlmIGRlZmluZWQgdXNlIHRvIGZldGNoIGNvbnRleHQgYWZ0ZXIgZ28tYmxldmUgY2FsbFxuICAgICAqL1xuICAgIGFzeW5jIHF1ZXJ5KGtleXM6IEFycmF5PHN0cmluZz4sIHNlYXJjaEZpbHRlcjogU2VhcmNoRmlsdGVyLCBzb3J0Qnk6IFNlYXJjaE9yZGVyLCBzZWFyY2hUZXJtOiBzdHJpbmcsIGZyb206IG51bWJlciwgY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQpOiBQcm9taXNlPFtBcnJheTxFdmVudExvb2t1cFJlc3VsdD4sIG51bWJlcl0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyOiBRdWVyeSA9IHt9O1xuXG4gICAgICAgIC8vIGluaXRpYWxpemUgZmllbGRzIHdlIHdpbGwgdXNlICh3ZSBkb24ndCB1c2Ugc2hvdWxkIGN1cnJlbnRseSlcbiAgICAgICAgZmlsdGVyLm11c3QgPSBuZXcgTWFwKCk7XG4gICAgICAgIGZpbHRlci5tdXN0Tm90ID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIG11c3Qgc2F0aXNmeSByb29tX2lkXG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIucm9vbXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3Jvb21faWQnLCBzZWFyY2hGaWx0ZXIucm9vbXMpO1xuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLm5vdFJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdyb29tX2lkJywgc2VhcmNoRmlsdGVyLm5vdFJvb21zKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgc2VuZGVyXG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIuc2VuZGVycy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0LnNldCgnc2VuZGVyJywgc2VhcmNoRmlsdGVyLnNlbmRlcnMpO1xuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLm5vdFNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3NlbmRlcicsIHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgdHlwZVxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnR5cGVzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCd0eXBlJywgc2VhcmNoRmlsdGVyLnR5cGVzKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RUeXBlcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0Tm90LnNldCgndHlwZScsIHNlYXJjaEZpbHRlci5ub3RUeXBlcyk7XG5cbiAgICAgICAgY29uc3QgcjogQmxldmVSZXF1ZXN0ID0ge1xuICAgICAgICAgICAgZnJvbSxcbiAgICAgICAgICAgIGtleXMsXG4gICAgICAgICAgICBmaWx0ZXIsXG4gICAgICAgICAgICBzb3J0QnksXG4gICAgICAgICAgICBzZWFyY2hUZXJtLFxuICAgICAgICAgICAgc2l6ZTogcGFnZVNpemUsXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzcDogQmxldmVSZXNwb25zZSA9IGF3YWl0IGIuc2VhcmNoKHIpO1xuICAgICAgICByZXR1cm4gW2F3YWl0IHRoaXMucmVzb2x2ZShyZXNwLnJvd3MsIGNvbnRleHQpLCByZXNwLnRvdGFsXTtcbiAgICB9XG59XG5cbmVudW0gU2VhcmNoT3JkZXIge1xuICAgIFJhbmsgPSAncmFuaycsXG4gICAgUmVjZW50ID0gJ3JlY2VudCcsXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNldHVwKCkge1xuICAgIGNvbnN0IGFyZ3MgPSBhcmd2LnJ1bigpO1xuXG4gICAgY29uc3QgYmFzZVVybCA9IGFyZ3Mub3B0aW9uc1sndXJsJ10gfHwgJ2h0dHBzOi8vbWF0cml4Lm9yZyc7XG5cbiAgICBsZXQgY3JlZHMgPSB7XG4gICAgICAgIHVzZXJJZDogZ2xvYmFsLmxvY2FsU3RvcmFnZS5nZXRJdGVtKCd1c2VySWQnKSxcbiAgICAgICAgZGV2aWNlSWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGV2aWNlSWQnKSxcbiAgICAgICAgYWNjZXNzVG9rZW46IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnYWNjZXNzVG9rZW4nKSxcbiAgICB9O1xuXG4gICAgaWYgKCFjcmVkcy51c2VySWQgfHwgIWNyZWRzLmRldmljZUlkIHx8ICFjcmVkcy5hY2Nlc3NUb2tlbikge1xuICAgICAgICBpZiAoIWFyZ3Mub3B0aW9uc1sndXNlcm5hbWUnXSB8fCAhYXJncy5vcHRpb25zWydwYXNzd29yZCddKSB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoJ3VzZXJuYW1lIGFuZCBwYXNzd29yZCB3ZXJlIG5vdCBzcGVjaWZpZWQgb24gdGhlIGNvbW1hbmRsaW5lIGFuZCBub25lIHdlcmUgc2F2ZWQnKTtcbiAgICAgICAgICAgIGFyZ3YuaGVscCgpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KC0xKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvZ2luQ2xpZW50OiBNYXRyaXhDbGllbnQgPSBjcmVhdGVDbGllbnQoe2Jhc2VVcmx9KTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgbG9naW5DbGllbnQubG9naW4oJ20ubG9naW4ucGFzc3dvcmQnLCB7XG4gICAgICAgICAgICAgICAgdXNlcjogYXJncy5vcHRpb25zWyd1c2VybmFtZSddLFxuICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBhcmdzLm9wdGlvbnNbJ3Bhc3N3b3JkJ10sXG4gICAgICAgICAgICAgICAgaW5pdGlhbF9kZXZpY2VfZGlzcGxheV9uYW1lOiAnTWF0cml4IFNlYXJjaCBEYWVtb24nLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKCdsb2dnZWQgaW4nLCB7dXNlcl9pZDogcmVzLnVzZXJfaWR9KTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgndXNlcklkJywgcmVzLnVzZXJfaWQpO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdkZXZpY2VJZCcsIHJlcy5kZXZpY2VfaWQpO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdhY2Nlc3NUb2tlbicsIHJlcy5hY2Nlc3NfdG9rZW4pO1xuXG4gICAgICAgICAgICBjcmVkcyA9IHtcbiAgICAgICAgICAgICAgICB1c2VySWQ6IHJlcy51c2VyX2lkLFxuICAgICAgICAgICAgICAgIGRldmljZUlkOiByZXMuZGV2aWNlX2lkLFxuICAgICAgICAgICAgICAgIGFjY2Vzc1Rva2VuOiByZXMuYWNjZXNzX3Rva2VuLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcignYW4gZXJyb3Igb2NjdXJyZWQgbG9nZ2luZyBpbicsIHtlcnJvcn0pO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY2xpOiBNYXRyaXhDbGllbnQgPSBjcmVhdGVDbGllbnQoe1xuICAgICAgICBiYXNlVXJsLFxuICAgICAgICBpZEJhc2VVcmw6ICcnLFxuICAgICAgICAuLi5jcmVkcyxcbiAgICAgICAgdXNlQXV0aG9yaXphdGlvbkhlYWRlcjogdHJ1ZSxcbiAgICAgICAgc3RvcmU6IG5ldyBNYXRyaXhJbk1lbW9yeVN0b3JlKHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZTogZ2xvYmFsLmxvY2FsU3RvcmFnZSxcbiAgICAgICAgfSksXG4gICAgICAgIHNlc3Npb25TdG9yZTogbmV3IFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUoZ2xvYmFsLmxvY2FsU3RvcmFnZSksXG4gICAgfSk7XG5cbiAgICBjbGkub24oJ2V2ZW50JywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuaXNFbmNyeXB0ZWQoKSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGNldiA9IGV2ZW50LmdldENsZWFyRXZlbnQoKTtcbiAgICAgICAgLy8gaWYgZXZlbnQgY2FuIGJlIHJlZGFjdGVkIG9yIGlzIGEgcmVkYWN0aW9uIHRoZW4gZW5xdWV1ZSBpdCBmb3IgcHJvY2Vzc2luZ1xuICAgICAgICBpZiAoZXZlbnQuZ2V0VHlwZSgpID09PSBcIm0ucm9vbS5yZWRhY3Rpb25cIiB8fCAhaW5kZXhhYmxlKGNldikpIHJldHVybjtcbiAgICAgICAgcmV0dXJuIHEucHVzaChjZXYpO1xuICAgIH0pO1xuICAgIGNsaS5vbignRXZlbnQuZGVjcnlwdGVkJywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuaXNEZWNyeXB0aW9uRmFpbHVyZSgpKSB7XG4gICAgICAgICAgICBsb2dnZXIud2FybignZGVjcnlwdGlvbiBmYWlsdXJlJywge2V2ZW50OiBldmVudC5ldmVudH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2V2ID0gZXZlbnQuZ2V0Q2xlYXJFdmVudCgpO1xuICAgICAgICBpZiAoIWluZGV4YWJsZShjZXYpKSByZXR1cm47XG4gICAgICAgIHJldHVybiBxLnB1c2goY2V2KTtcbiAgICB9KTtcblxuICAgIC8vIGNsaS5vbignUm9vbS5yZWRhY3Rpb24nLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgLy8gICAgIHJldHVybiBxLnB1c2goe1xuICAgIC8vICAgICAgICAgdHlwZTogSm9iVHlwZS5yZWRhY3QsXG4gICAgLy8gICAgICAgICBldmVudDogZXZlbnQuZ2V0Q2xlYXJFdmVudCgpLFxuICAgIC8vICAgICB9KTtcbiAgICAvLyB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdpbml0aWFsaXppbmcgY3J5cHRvJyk7XG4gICAgICAgIGF3YWl0IGNsaS5pbml0Q3J5cHRvKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdmYWlsZWQgdG8gaW5pdCBjcnlwdG8nLCB7ZXJyb3J9KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KC0xKTtcbiAgICB9XG4gICAgbG9nZ2VyLmluZm8oJ2NyeXB0byBpbml0aWFsaXplZCcpO1xuXG4gICAgLy8gY3JlYXRlIHN5bmMgZmlsdGVyXG4gICAgY29uc3QgZmlsdGVyID0gbmV3IEZpbHRlcihjbGkuY3JlZGVudGlhbHMudXNlcklkKTtcbiAgICBmaWx0ZXIuc2V0RGVmaW5pdGlvbih7XG4gICAgICAgIHJvb206IHtcbiAgICAgICAgICAgIGluY2x1ZGVfbGVhdmU6IGZhbHNlLCAvLyBUT0RPOiBub3Qgc3VyZSBoZXJlXG4gICAgICAgICAgICBlcGhlbWVyYWw6IHsgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCBlcGhlbWVyYWwgZXZlbnRzXG4gICAgICAgICAgICAgICAgbGltaXQ6IDAsXG4gICAgICAgICAgICAgICAgdHlwZXM6IFtdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGFjY291bnRfZGF0YTogeyAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IHJvb20gYWNjb3VudF9kYXRhXG4gICAgICAgICAgICAgICAgbGltaXQ6IDAsXG4gICAgICAgICAgICAgICAgdHlwZXM6IFtdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIHN0YXRlOiB7IC8vIFRPRE86IGRvIHdlIGNhcmUgYWJvdXQgc3RhdGVcbiAgICAgICAgICAgIC8vICAgICBsaW1pdDogMCxcbiAgICAgICAgICAgIC8vICAgICB0eXBlczogW10sXG4gICAgICAgICAgICAvLyB9LFxuICAgICAgICAgICAgLy8gdGltZWxpbmU6IHsgLy8gVE9ETyBkbyB3ZSB3YW50IGFsbCB0aW1lbGluZSBldnNcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyB9XG4gICAgICAgIH0sXG4gICAgICAgIHByZXNlbmNlOiB7IC8vIHdlIGRvbid0IGNhcmUgYWJvdXQgcHJlc2VuY2VcbiAgICAgICAgICAgIGxpbWl0OiAwLFxuICAgICAgICAgICAgdHlwZXM6IFtdLFxuICAgICAgICB9LFxuICAgICAgICBhY2NvdW50X2RhdGE6IHsgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCBnbG9iYWwgYWNjb3VudF9kYXRhXG4gICAgICAgICAgICBsaW1pdDogMCxcbiAgICAgICAgICAgIHR5cGVzOiBbXSxcbiAgICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdsb2FkaW5nL2NyZWF0aW5nIHN5bmMgZmlsdGVyJyk7XG4gICAgICAgIGZpbHRlci5maWx0ZXJJZCA9IGF3YWl0IGNsaS5nZXRPckNyZWF0ZUZpbHRlcihmaWx0ZXJOYW1lKGNsaSksIGZpbHRlcik7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdmYWlsZWQgdG8gZ2V0T3JDcmVhdGUgc3luYyBmaWx0ZXInLCB7ZXJyb3J9KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KC0xKTtcbiAgICB9XG4gICAgbG9nZ2VyLmluZm8oJ3N5bmMgZmlsdGVyIGxvYWRlZCcsIHtmaWx0ZXJfaWQ6IGZpbHRlci5nZXRGaWx0ZXJJZCgpfSk7XG5cbiAgICBsb2dnZXIuaW5mbygnc3RhcnRpbmcgY2xpZW50Jyk7XG4gICAgLy8gZmlsdGVyIHN5bmMgdG8gaW1wcm92ZSBwZXJmb3JtYW5jZVxuICAgIGNsaS5zdGFydENsaWVudCh7XG4gICAgICAgIGRpc2FibGVQcmVzZW5jZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyLFxuICAgIH0pO1xuICAgIGxvZ2dlci5pbmZvKCdjbGllbnQgc3RhcnRlZCcpO1xuXG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGFwcC51c2UoYm9keVBhcnNlci5qc29uKCkpO1xuICAgIGFwcC51c2UoY29ycyh7XG4gICAgICAgICdhbGxvd2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJywgJ0NvbnRlbnQtVHlwZSddLFxuICAgICAgICAnZXhwb3NlZEhlYWRlcnMnOiBbJ2FjY2Vzc190b2tlbiddLFxuICAgICAgICAnb3JpZ2luJzogJyonLFxuICAgICAgICAnbWV0aG9kcyc6ICdQT1NUJyxcbiAgICAgICAgJ3ByZWZsaWdodENvbnRpbnVlJzogZmFsc2VcbiAgICB9KSk7XG5cbiAgICBhcHAucG9zdCgnL3NlYXJjaCcsIGFzeW5jIChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFyZXEuYm9keSkge1xuICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNDAwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBuZXh0QmF0Y2g6IEJhdGNoIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGlmIChyZXEucXVlcnlbJ25leHRfYmF0Y2gnXSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBuZXh0QmF0Y2ggPSBKU09OLnBhcnNlKGdsb2JhbC5hdG9iKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSk7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ2ZvdW5kIG5leHQgYmF0Y2ggb2YnLCB7bmV4dF9iYXRjaDogbmV4dEJhdGNofSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcignZmFpbGVkIHRvIHBhcnNlIG5leHRfYmF0Y2ggYXJndW1lbnQnLCB7ZXJyb3J9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZlcmlmeSB0aGF0IHVzZXIgaXMgYWxsb3dlZCB0byBhY2Nlc3MgdGhpcyB0aGluZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY2FzdEJvZHk6IE1hdHJpeFNlYXJjaFJlcXVlc3QgPSByZXEuYm9keTtcbiAgICAgICAgICAgIGNvbnN0IHJvb21DYXQgPSBjYXN0Qm9keS5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cztcblxuICAgICAgICAgICAgaWYgKCFyb29tQ2F0KSB7XG4gICAgICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAxKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBrZXlzOiBBcnJheTxSZXF1ZXN0S2V5PiA9IFtSZXF1ZXN0S2V5LmJvZHksIFJlcXVlc3RLZXkubmFtZSwgUmVxdWVzdEtleS50b3BpY107IC8vIGRlZmF1bHQgdmFsdWUgZm9yIHJvb21DYXQua2V5XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5rZXlzICYmIHJvb21DYXQua2V5cy5sZW5ndGgpIGtleXMgPSByb29tQ2F0LmtleXM7XG5cbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGVTdGF0ZSA9IEJvb2xlYW4ocm9vbUNhdFsnaW5jbHVkZV9zdGF0ZSddKTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50Q29udGV4dCA9IHJvb21DYXRbJ2V2ZW50X2NvbnRleHQnXTtcblxuICAgICAgICAgICAgbGV0IGdyb3VwQnlSb29tSWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxldCBncm91cEJ5U2VuZGVyID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5ncm91cGluZ3MgJiYgcm9vbUNhdC5ncm91cGluZ3MuZ3JvdXBfYnkpIHtcbiAgICAgICAgICAgICAgICByb29tQ2F0Lmdyb3VwaW5ncy5ncm91cF9ieS5mb3JFYWNoKGdyb3VwaW5nID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChncm91cGluZy5rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnJvb21JZDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5Um9vbUlkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnNlbmRlcjpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5U2VuZGVyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXIgPSBuZXcgU2VhcmNoRmlsdGVyKHJvb21DYXQuZmlsdGVyIHx8IHt9KTsgLy8gZGVmYXVsdCB0byBlbXB0eSBvYmplY3QgdG8gYXNzdW1lIGRlZmF1bHRzXG5cbiAgICAgICAgICAgIC8vIFRPRE8gdGhpcyBpcyByZW1vdmVkIGJlY2F1c2Ugcm9vbXMgc3RvcmUgaXMgdW5yZWxpYWJsZSBBRlxuICAgICAgICAgICAgLy8gY29uc3Qgam9pbmVkUm9vbXMgPSBjbGkuZ2V0Um9vbXMoKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IHJvb21JZHMgPSBqb2luZWRSb29tcy5tYXAoKHJvb206IFJvb20pID0+IHJvb20ucm9vbUlkKTtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyBpZiAocm9vbUlkcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAvLyAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgLy8gICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgfSk7XG4gICAgICAgICAgICAvLyAgICAgcmV0dXJuO1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICAvLyBTS0lQIGZvciBub3dcbiAgICAgICAgICAgIC8vIGxldCByb29tSWRzU2V0ID0gc2VhcmNoRmlsdGVyLmZpbHRlclJvb21zKHJvb21JZHMpO1xuXG4gICAgICAgICAgICAvLyBpZiAoYi5pc0dyb3VwaW5nKFwicm9vbV9pZFwiKSkge1xuICAgICAgICAgICAgLy8gICAgIHJvb21JRHNTZXQuSW50ZXJzZWN0KGNvbW1vbi5OZXdTdHJpbmdTZXQoW11zdHJpbmd7KmIuR3JvdXBLZXl9KSlcbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgLy8gVE9ETyBkbyB3ZSBuZWVkIHRoaXNcbiAgICAgICAgICAgIC8vcmFua01hcCA6PSBtYXBbc3RyaW5nXWZsb2F0NjR7fVxuICAgICAgICAgICAgLy9hbGxvd2VkRXZlbnRzIDo9IFtdKlJlc3VsdHt9XG4gICAgICAgICAgICAvLyBUT0RPIHRoZXNlIG5lZWQgY2hhbmdpbmdcbiAgICAgICAgICAgIGNvbnN0IHJvb21Hcm91cHMgPSBuZXcgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4oKTtcbiAgICAgICAgICAgIGNvbnN0IHNlbmRlckdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuXG4gICAgICAgICAgICBsZXQgZ2xvYmFsTmV4dEJhdGNoOiBzdHJpbmd8dW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBjb25zdCByb29tcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2ggPSBuZXcgU2VhcmNoKGNsaSk7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hUZXJtID0gcm9vbUNhdFsnc2VhcmNoX3Rlcm0nXTtcblxuICAgICAgICAgICAgbGV0IGFsbG93ZWRFdmVudHM6IEFycmF5PEV2ZW50TG9va3VwUmVzdWx0PjtcbiAgICAgICAgICAgIGxldCBjb3VudDogbnVtYmVyID0gMDtcblxuICAgICAgICAgICAgLy8gVE9ETyBleHRlbmQgbG9jYWwgZXZlbnQgbWFwIHVzaW5nIHNxbGl0ZS9sZXZlbGRiXG4gICAgICAgICAgICBzd2l0Y2ggKHJvb21DYXRbJ29yZGVyX2J5J10pIHtcbiAgICAgICAgICAgICAgICBjYXNlICdyYW5rJzpcbiAgICAgICAgICAgICAgICBjYXNlICcnOlxuICAgICAgICAgICAgICAgICAgICAvLyBnZXQgbWVzc2FnZXMgZnJvbSBCbGV2ZSBieSByYW5rIC8vIHJlc29sdmUgdGhlbSBsb2NhbGx5XG4gICAgICAgICAgICAgICAgICAgIFthbGxvd2VkRXZlbnRzLCBjb3VudF0gPSBhd2FpdCBzZWFyY2gucXVlcnkoa2V5cywgc2VhcmNoRmlsdGVyLCBTZWFyY2hPcmRlci5SYW5rLCBzZWFyY2hUZXJtLCAwLCBldmVudENvbnRleHQpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ3JlY2VudCc6XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSBuZXh0QmF0Y2ggIT09IG51bGwgPyBuZXh0QmF0Y2guZnJvbSgpIDogMDtcbiAgICAgICAgICAgICAgICAgICAgW2FsbG93ZWRFdmVudHMsIGNvdW50XSA9IGF3YWl0IHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJlY2VudCwgc2VhcmNoVGVybSwgZnJvbSwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBnZXQgbmV4dCBiYWNrIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDEpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhbGxvd2VkRXZlbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGhpZ2hsaWdodHNTdXBlcnNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8UmVzdWx0PiA9IFtdO1xuXG4gICAgICAgICAgICBhbGxvd2VkRXZlbnRzLmZvckVhY2goKHJvdzogRXZlbnRMb29rdXBSZXN1bHQpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYWxjdWxhdGUgaGlnaHRsaWdodHNTdXBlcnNldFxuICAgICAgICAgICAgICAgIHJvdy5oaWdobGlnaHRzLmZvckVhY2goKGhpZ2hsaWdodDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHNTdXBlcnNldC5hZGQoaGlnaGxpZ2h0KTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHtldmVudDogZXZ9ID0gcm93O1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHYgPSByb29tR3JvdXBzLmdldChldi5nZXRSb29tSWQoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICByb29tR3JvdXBzLnNldChldi5nZXRSb29tSWQoKSwgdik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gc2VuZGVyR3JvdXBzLmdldChldi5nZXRTZW5kZXIoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICBzZW5kZXJHcm91cHMuc2V0KGV2LmdldFNlbmRlcigpLCB2KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByb29tcy5hZGQoZXYuZ2V0Um9vbUlkKCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gYWRkIHRvIHJlc3VsdHMgYXJyYXlcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPCBzZWFyY2hGaWx0ZXIubGltaXQpXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICByYW5rOiByb3cuc2NvcmUsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJvdy5ldmVudC5ldmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQ6IHJvdy5jb250ZXh0LFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21TdGF0ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTxNYXRyaXhFdmVudD4+KCk7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETyBmZXRjaCBzdGF0ZSBmcm9tIHNlcnZlciB1c2luZyBBUEkgYmVjYXVzZSBqcy1zZGsgaXMgYnJva2VuIGR1ZSB0byBzdG9yZVxuICAgICAgICAgICAgICAgIHJvb21zLmZvckVhY2goKHJvb21JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvb20gPSBjbGkuZ2V0Um9vbShyb29tSWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocm9vbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbVN0YXRlTWFwLnNldChyb29tSWQsIHJvb20uY3VycmVudFN0YXRlLnJlZHVjZSgoYWNjLCBtYXA6IE1hcDxzdHJpbmcsIE1hdHJpeEV2ZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjLnB1c2goZXYpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBbXSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3A6IE1hdHJpeFNlYXJjaFJlc3BvbnNlID0ge1xuICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7fSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvLyBzcGxpdCB0byBtYWtlIFR5cGVTY3JpcHQgaGFwcHkgd2l0aCB0aGUgaWYgc3RhdGVtZW50cyBmb2xsb3dpbmdcbiAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMgPSB7XG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogaGlnaGxpZ2h0c1N1cGVyc2V0LFxuICAgICAgICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgICAgICAgY291bnQsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBvbWl0ZW1wdHkgYmVoYXZpb3VyIHVzaW5nIGlmIHRvIGF0dGFjaCBvbnRvIG9iamVjdCB0byBiZSBzZXJpYWxpemVkXG4gICAgICAgICAgICBpZiAoZ2xvYmFsTmV4dEJhdGNoKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLm5leHRfYmF0Y2ggPSBnbG9iYWxOZXh0QmF0Y2g7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLnN0YXRlID0gcm9vbVN0YXRlTWFwO1xuXG4gICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCB8fCBncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5ncm91cHMgPSBuZXcgTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+KCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCkge1xuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIocm9vbUdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkucm9vbUlkLCByb29tR3JvdXBzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlTZW5kZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplR3JvdXBWYWx1ZU9yZGVyKHNlbmRlckdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkuc2VuZGVyLCBzZW5kZXJHcm91cHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAgICAgICByZXMuanNvbihyZXNwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcignY2F0YXN0cm9waGUnLCB7ZXJyb3J9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcy5zZW5kU3RhdHVzKDUwMCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBwb3J0ID0gYXJncy5vcHRpb25zWydwb3J0J10gfHwgODAwMDtcbiAgICBhcHAubGlzdGVuKHBvcnQsICgpID0+IHtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ3dlIGFyZSBsaXZlJywge3BvcnR9KTtcbiAgICB9KTtcbn1cblxuLy8gVE9ETyBwYWdpbmF0aW9uXG4vLyBUT0RPIGdyb3Vwcy1wYWdpbmF0aW9uXG4vLyBUT0RPIGJhY2tmaWxsXG5cbmZ1bmN0aW9uIGZpbHRlck5hbWUoY2xpOiBNYXRyaXhDbGllbnQpOiBzdHJpbmcge1xuICAgIHJldHVybiBgTUFUUklYX1NFQVJDSF9GSUxURVJfJHtjbGkuY3JlZGVudGlhbHMudXNlcklkfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwVmFsdWVPcmRlcihpdDogSXRlcmFibGVJdGVyYXRvcjxHcm91cFZhbHVlPikge1xuICAgIGxldCBpID0gMTtcbiAgICBBcnJheS5mcm9tKGl0KS5zb3J0KChhOiBHcm91cFZhbHVlLCBiOiBHcm91cFZhbHVlKSA9PiBhLm9yZGVyLWIub3JkZXIpLmZvckVhY2goKGc6IEdyb3VwVmFsdWUpID0+IHtcbiAgICAgICAgLy8gbm9ybWFsaXplIG9yZGVyIGJhc2VkIG9uIHNvcnQgYnkgZmxvYXRcbiAgICAgICAgZy5vcmRlciA9IGkrKztcbiAgICB9KTtcbn1cblxuY2xhc3MgU2VhcmNoRmlsdGVyIHtcbiAgICByb29tczogU2V0PHN0cmluZz47XG4gICAgbm90Um9vbXM6IFNldDxzdHJpbmc+O1xuICAgIHNlbmRlcnM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFNlbmRlcnM6IFNldDxzdHJpbmc+O1xuICAgIHR5cGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RUeXBlczogU2V0PHN0cmluZz47XG4gICAgbGltaXQ6IG51bWJlcjtcbiAgICBjb250YWluc1VSTDogYm9vbGVhbiB8IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0cnVjdG9yKG86IG9iamVjdCkge1xuICAgICAgICB0aGlzLnJvb21zID0gbmV3IFNldDxzdHJpbmc+KG9bJ3Jvb21zJ10pO1xuICAgICAgICB0aGlzLm5vdFJvb21zID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF9yb29tcyddKTtcbiAgICAgICAgdGhpcy5zZW5kZXJzID0gbmV3IFNldDxzdHJpbmc+KG9bJ3NlbmRlcnMnXSk7XG4gICAgICAgIHRoaXMubm90U2VuZGVycyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3Rfc2VuZGVycyddKTtcbiAgICAgICAgdGhpcy50eXBlcyA9IG5ldyBTZXQ8c3RyaW5nPihvWyd0eXBlcyddKTtcbiAgICAgICAgdGhpcy5ub3RUeXBlcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3RfdHlwZXMnXSk7XG5cbiAgICAgICAgdGhpcy5saW1pdCA9IHR5cGVvZiBvWydsaW1pdCddID09PSBcIm51bWJlclwiID8gb1snbGltaXQnXSA6IDEwO1xuICAgICAgICB0aGlzLmNvbnRhaW5zVVJMID0gb1snY29udGFpbnNfdXJsJ107XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEV2ZW50Q29udGV4dCB7XG4gICAgYmVmb3JlX2xpbWl0PzogbnVtYmVyO1xuICAgIGFmdGVyX2xpbWl0PzogbnVtYmVyO1xuICAgIGluY2x1ZGVfcHJvZmlsZTogYm9vbGVhbjtcbn1cblxuZW51bSBSZXF1ZXN0R3JvdXBLZXkge1xuICAgIHJvb21JZCA9IFwicm9vbV9pZFwiLFxuICAgIHNlbmRlciA9IFwic2VuZGVyXCIsXG59XG5cbmludGVyZmFjZSBSZXF1ZXN0R3JvdXAge1xuICAgIGtleTogUmVxdWVzdEdyb3VwS2V5O1xufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEdyb3VwcyB7XG4gICAgZ3JvdXBfYnk/OiBBcnJheTxSZXF1ZXN0R3JvdXA+O1xufVxuXG5lbnVtIFJlcXVlc3RLZXkge1xuICAgIGJvZHkgPSBcImNvbnRlbnQuYm9keVwiLFxuICAgIG5hbWUgPSBcImNvbnRlbnQubmFtZVwiLFxuICAgIHRvcGljID0gXCJjb250ZW50LnRvcGljXCIsXG59XG5cbmNvbnN0IGluZGV4YWJsZUtleXMgPSBbUmVxdWVzdEtleS5ib2R5LCBSZXF1ZXN0S2V5Lm5hbWUsIFJlcXVlc3RLZXkudG9waWNdO1xuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVxdWVzdEJvZHkge1xuICAgIHNlYXJjaF90ZXJtOiBzdHJpbmc7XG4gICAga2V5cz86IEFycmF5PFJlcXVlc3RLZXk+O1xuICAgIGZpbHRlcj86IG9iamVjdDsgLy8gdGhpcyBnZXRzIGluZmxhdGVkIHRvIGFuIGluc3RhbmNlIG9mIEZpbHRlclxuICAgIG9yZGVyX2J5Pzogc3RyaW5nO1xuICAgIGV2ZW50X2NvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0O1xuICAgIGluY2x1ZGVTdGF0ZT86IGJvb2xlYW47XG4gICAgZ3JvdXBpbmdzPzogUmVxdWVzdEdyb3Vwcztcbn1cblxuaW50ZXJmYWNlIE1hdHJpeFNlYXJjaFJlcXVlc3Qge1xuICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgIHJvb21fZXZlbnRzPzogTWF0cml4U2VhcmNoUmVxdWVzdEJvZHk7XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVzcG9uc2Uge1xuICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgIHJvb21fZXZlbnRzPzoge1xuICAgICAgICAgICAgY291bnQ6IG51bWJlcjtcbiAgICAgICAgICAgIHJlc3VsdHM6IEFycmF5PFJlc3VsdD47XG4gICAgICAgICAgICBoaWdobGlnaHRzOiBTZXQ8c3RyaW5nPjtcbiAgICAgICAgICAgIHN0YXRlPzogTWFwPHN0cmluZywgQXJyYXk8RXZlbnQ+PjtcbiAgICAgICAgICAgIGdyb3Vwcz86IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+PjtcbiAgICAgICAgICAgIG5leHRfYmF0Y2g/OiBzdHJpbmc7XG4gICAgICAgIH1cbiAgICB9XG59Il19