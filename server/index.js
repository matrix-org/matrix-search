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
const lodash_get_1 = __importDefault(require("lodash.get"));
const argv_1 = __importDefault(require("argv"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const mkdirp = __importStar(require("mkdirp"));
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
q.on('task_queued', function (taskId, ev) {
    const { room_id, event_id, sender, type } = ev;
    if (ev.redacts) {
        console.info(`Enqueue event for redaction ${room_id}/${event_id} (${taskId})`);
    }
    else {
        console.info(`Enqueue event for indexing ${room_id}/${event_id} ${sender} [${type}] (${taskId})`);
    }
});
q.on('batch_failed', function (err) {
    console.error("[ERROR] Batch failed: ", err);
});
setup().then(console.log).catch(console.error);
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
            console.log('Username and Password were not specified on the commandline and none were saved');
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
            console.log('Logged in as ' + res.user_id);
            global.localStorage.setItem('userId', res.user_id);
            global.localStorage.setItem('deviceId', res.device_id);
            global.localStorage.setItem('accessToken', res.access_token);
            creds = {
                userId: res.user_id,
                deviceId: res.device_id,
                accessToken: res.access_token,
            };
        }
        catch (err) {
            console.log('An error occured logging in!');
            console.log(err);
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
            console.warn(event.event);
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
        console.info("initializing crypto");
        await cli.initCrypto();
    }
    catch (e) {
        console.error("Failed to init crypto.");
        console.error(e);
        process.exit(-1);
    }
    console.info("crypto initialized");
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
        console.info("loading/creating sync filter");
        filter.filterId = await cli.getOrCreateFilter(filterName(cli), filter);
    }
    catch (e) {
        console.error("Failed to getOrCreate sync filter.");
        console.error(e);
        process.exit(-1);
    }
    console.info("sync filter loaded");
    console.info("starting client");
    // filter sync to improve performance
    cli.startClient({
        disablePresence: true,
        filter,
    });
    console.info("client started");
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
                console.info("Found next batch of", nextBatch);
            }
            catch (e) {
                console.error("Failed to parse next_batch argument", e);
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
        catch (e) {
            console.log("Catastrophe", e);
        }
        res.sendStatus(500);
    });
    const port = args.options['port'] || 8000;
    app.listen(port, () => {
        console.log(`We are live on ${port}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFNQSw0REFBNkI7QUFDN0IsZ0RBQXdCO0FBRXhCLGdEQUF3QjtBQUN4QixzREFBbUQ7QUFDbkQsOERBQXFDO0FBQ3JDLCtDQUFpQztBQUlqQywwREFBMEQ7QUFDMUQsTUFBTSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFNUIsaURBZ0J1QjtBQUN2Qiw2Q0FBNkM7QUFDN0MsK0JBQTZCO0FBQzdCLDZDQUE2QztBQUM3Qyx5QkFBdUI7QUFFdkIsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQ3RDLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBQ25ELE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0FBRTNDLE1BQU0sdUJBQXVCLEdBQUcsT0FBTyxDQUFDLDBEQUEwRCxDQUFDLENBQUMsT0FBTyxDQUFDO0FBRTVHLGdEQUFnRDtBQUNoRCxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3ZCLDhCQUE4QjtBQUM5QixJQUFJLE9BQU8sTUFBTSxDQUFDLFlBQVksS0FBSyxXQUFXLElBQUksTUFBTSxDQUFDLFlBQVksS0FBSyxJQUFJO0lBQzFFLE1BQU0sQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUM7QUFFbEcscUNBQXFCLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSx1QkFBdUIsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztBQUU5RSxjQUFJLENBQUMsTUFBTSxDQUFDO0lBQ1I7UUFDSSxJQUFJLEVBQUUsS0FBSztRQUNYLElBQUksRUFBRSxRQUFRO1FB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dXJjZXNDb250ZW50IjpbImRlY2xhcmUgdmFyIGdsb2JhbDoge1xuICAgIE9sbTogYW55XG4gICAgbG9jYWxTdG9yYWdlPzogYW55XG4gICAgYXRvYjogKHN0cmluZykgPT4gc3RyaW5nO1xufTtcblxuaW1wb3J0IGdldCBmcm9tICdsb2Rhc2guZ2V0JztcbmltcG9ydCBhcmd2IGZyb20gJ2FyZ3YnO1xuaW1wb3J0IHtSZXF1ZXN0UHJvbWlzZSwgUmVxdWVzdFByb21pc2VPcHRpb25zfSBmcm9tIFwicmVxdWVzdC1wcm9taXNlXCI7XG5pbXBvcnQgY29ycyBmcm9tICdjb3JzJztcbmltcG9ydCBleHByZXNzLCB7UmVxdWVzdCwgUmVzcG9uc2V9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgYm9keVBhcnNlciBmcm9tICdib2R5LXBhcnNlcic7XG5pbXBvcnQgKiBhcyBta2RpcnAgZnJvbSBcIm1rZGlycFwiO1xuXG5pbXBvcnQge1JlcXVlc3RBUEksIFJlcXVpcmVkVXJpVXJsfSBmcm9tIFwicmVxdWVzdFwiO1xuXG4vLyBpbXBvcnQgT2xtIGJlZm9yZSBpbXBvcnRpbmcganMtc2RrIHRvIHByZXZlbnQgaXQgY3J5aW5nXG5nbG9iYWwuT2xtID0gcmVxdWlyZSgnb2xtJyk7XG5cbmltcG9ydCB7XG4gICAgUm9vbSxcbiAgICBFdmVudCxcbiAgICBGaWx0ZXIsXG4gICAgTWF0cml4LFxuICAgIE1hdHJpeEV2ZW50LFxuICAgIFVzZXJQcm9maWxlLFxuICAgIGNyZWF0ZUNsaWVudCxcbiAgICBFdmVudENvbnRleHQsXG4gICAgTWF0cml4Q2xpZW50LFxuICAgIEluZGV4ZWREQlN0b3JlLFxuICAgIEV2ZW50V2l0aENvbnRleHQsXG4gICAgTWF0cml4SW5NZW1vcnlTdG9yZSxcbiAgICBJbmRleGVkREJDcnlwdG9TdG9yZSxcbiAgICBzZXRDcnlwdG9TdG9yZUZhY3RvcnksXG4gICAgV2ViU3RvcmFnZVNlc3Npb25TdG9yZSxcbn0gZnJvbSAnbWF0cml4LWpzLXNkayc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hdHJpeENsaWVudCBwcm90b3R5cGVcbmltcG9ydCAnLi9tYXRyaXhfY2xpZW50X2V4dCc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hcCBhbmQgU2V0IHByb3RvdHlwZXNcbmltcG9ydCAnLi9idWlsdGluX2V4dCc7XG5cbmNvbnN0IFF1ZXVlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlJyk7XG5jb25zdCBTcWxpdGVTdG9yZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZS1zcWxpdGUnKTtcbmNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0LXByb21pc2UnKTtcblxuY29uc3QgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL2xpYi9jcnlwdG8vc3RvcmUvbG9jYWxTdG9yYWdlLWNyeXB0by1zdG9yZScpLmRlZmF1bHQ7XG5cbi8vIGNyZWF0ZSBkaXJlY3Rvcnkgd2hpY2ggd2lsbCBob3VzZSB0aGUgc3RvcmVzLlxubWtkaXJwLnN5bmMoJy4vc3RvcmUnKTtcbi8vIExvYWRpbmcgbG9jYWxTdG9yYWdlIG1vZHVsZVxuaWYgKHR5cGVvZiBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBcInVuZGVmaW5lZFwiIHx8IGdsb2JhbC5sb2NhbFN0b3JhZ2UgPT09IG51bGwpXG4gICAgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9IG5ldyAocmVxdWlyZSgnbm9kZS1sb2NhbHN0b3JhZ2UnKS5Mb2NhbFN0b3JhZ2UpKCcuL3N0b3JlL2xvY2FsU3RvcmFnZScpO1xuXG5zZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IExvY2FsU3RvcmFnZUNyeXB0b1N0b3JlKGdsb2JhbC5sb2NhbFN0b3JhZ2UpKTtcblxuYXJndi5vcHRpb24oW1xuICAgIHtcbiAgICAgICAgbmFtZTogJ3VybCcsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSBVUkwgdG8gYmUgdXNlZCB0byBjb25uZWN0IHRvIHRoZSBNYXRyaXggSFMnLFxuICAgIH0sIHtcbiAgICAgICAgbmFtZTogJ3VzZXJuYW1lJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGhlIHVzZXJuYW1lIHRvIGJlIHVzZWQgdG8gY29ubmVjdCB0byB0aGUgTWF0cml4IEhTJyxcbiAgICB9LCB7XG4gICAgICAgIG5hbWU6ICdwYXNzd29yZCcsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSBwYXNzd29yZCB0byBiZSB1c2VkIHRvIGNvbm5lY3QgdG8gdGhlIE1hdHJpeCBIUycsXG4gICAgfSwge1xuICAgICAgICBuYW1lOiAncG9ydCcsXG4gICAgICAgIHR5cGU6ICdpbnQnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1BvcnQgdG8gYmluZCB0byAoZGVmYXVsdCA4MDAwKScsXG4gICAgfVxuXSk7XG5cbmNsYXNzIEJsZXZlSHR0cCB7XG4gICAgcmVxdWVzdDogUmVxdWVzdEFQSTxSZXF1ZXN0UHJvbWlzZSwgUmVxdWVzdFByb21pc2VPcHRpb25zLCBSZXF1aXJlZFVyaVVybD47XG5cbiAgICBjb25zdHJ1Y3RvcihiYXNlVXJsOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5yZXF1ZXN0ID0gcmVxdWVzdC5kZWZhdWx0cyh7YmFzZVVybH0pO1xuICAgIH1cblxuICAgIGVucXVldWUoZXZlbnRzOiBBcnJheTxFdmVudD4pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdlbnF1ZXVlJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAganNvbjogdHJ1ZSxcbiAgICAgICAgICAgIGJvZHk6IGV2ZW50cyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2VhcmNoKHJlcTogQmxldmVSZXF1ZXN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAncXVlcnknLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogcmVxLFxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmNvbnN0IGIgPSBuZXcgQmxldmVIdHRwKFwiaHR0cDovL2xvY2FsaG9zdDo5OTk5L2FwaS9cIik7XG5cbmZ1bmN0aW9uIGluZGV4YWJsZShldjogRXZlbnQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW5kZXhhYmxlS2V5cy5zb21lKChrZXk6IHN0cmluZykgPT4gZ2V0KGV2LCBrZXkpICE9PSB1bmRlZmluZWQpO1xufVxuXG5jb25zdCBxID0gbmV3IFF1ZXVlKGFzeW5jIChiYXRjaDogQXJyYXk8RXZlbnQ+LCBjYikgPT4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNiKG51bGwsIGF3YWl0IGIuZW5xdWV1ZShiYXRjaCkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2IoZSk7XG4gICAgfVxufSwge1xuICAgIGJhdGNoU2l6ZTogMTAwLFxuICAgIG1heFJldHJpZXM6IDEwMCxcbiAgICByZXRyeURlbGF5OiA1MDAwLFxuICAgIHN0b3JlOiBuZXcgU3FsaXRlU3RvcmUoe1xuICAgICAgICBwYXRoOiAnLi9zdG9yZS9xdWV1ZS5zcWxpdGUnLFxuICAgIH0pLFxufSk7XG5cbnEub24oJ3Rhc2tfcXVldWVkJywgZnVuY3Rpb24odGFza0lkOiBzdHJpbmcsIGV2OiBFdmVudCkge1xuICAgIGNvbnN0IHtyb29tX2lkLCBldmVudF9pZCwgc2VuZGVyLCB0eXBlfSA9IGV2O1xuICAgIGlmIChldi5yZWRhY3RzKSB7XG4gICAgICAgIGNvbnNvbGUuaW5mbyhgRW5xdWV1ZSBldmVudCBmb3IgcmVkYWN0aW9uICR7cm9vbV9pZH0vJHtldmVudF9pZH0gKCR7dGFza0lkfSlgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmluZm8oYEVucXVldWUgZXZlbnQgZm9yIGluZGV4aW5nICR7cm9vbV9pZH0vJHtldmVudF9pZH0gJHtzZW5kZXJ9IFske3R5cGV9XSAoJHt0YXNrSWR9KWApO1xuICAgIH1cbn0pO1xuXG5xLm9uKCdiYXRjaF9mYWlsZWQnLCBmdW5jdGlvbihlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW0VSUk9SXSBCYXRjaCBmYWlsZWQ6IFwiLCBlcnIpO1xufSk7XG5cbnNldHVwKCkudGhlbihjb25zb2xlLmxvZykuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbmludGVyZmFjZSBHcm91cFZhbHVlSlNPTiB7XG4gICAgb3JkZXI6IG51bWJlcjtcbiAgICBuZXh0X2JhdGNoPzogc3RyaW5nO1xuICAgIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG59XG5cbmNsYXNzIEdyb3VwVmFsdWUge1xuICAgIHB1YmxpYyBvcmRlcjogbnVtYmVyO1xuICAgIHB1YmxpYyBuZXh0X2JhdGNoOiBzdHJpbmc7XG4gICAgcHVibGljIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG5cbiAgICBjb25zdHJ1Y3RvcihvcmRlcjogbnVtYmVyKSB7XG4gICAgICAgIHRoaXMub3JkZXIgPSBvcmRlcjtcbiAgICAgICAgdGhpcy5uZXh0X2JhdGNoID0gXCJcIjtcbiAgICAgICAgdGhpcy5yZXN1bHRzID0gW107XG4gICAgfVxuXG4gICAgYWRkKGV2ZW50SWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlc3VsdHMucHVzaChldmVudElkKTtcbiAgICB9XG5cbiAgICAvLyBkb24ndCBzZW5kIG5leHRfYmF0Y2ggaWYgaXQgaXMgZW1wdHlcbiAgICB0b0pTT04oKTogR3JvdXBWYWx1ZUpTT04ge1xuICAgICAgICBjb25zdCBvOiBHcm91cFZhbHVlSlNPTiA9IHtcbiAgICAgICAgICAgIG9yZGVyOiB0aGlzLm9yZGVyLFxuICAgICAgICAgICAgcmVzdWx0czogdGhpcy5yZXN1bHRzLFxuICAgICAgICB9O1xuICAgICAgICBpZiAodGhpcy5uZXh0X2JhdGNoKSBvLm5leHRfYmF0Y2ggPSB0aGlzLm5leHRfYmF0Y2g7XG4gICAgICAgIHJldHVybiBvO1xuICAgIH1cbn1cblxuY2xhc3MgQmF0Y2gge1xuICAgIHB1YmxpYyBUb2tlbjogbnVtYmVyO1xuICAgIHB1YmxpYyBHcm91cDogc3RyaW5nO1xuICAgIHB1YmxpYyBHcm91cEtleTogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3IoVG9rZW46IG51bWJlciA9IDAsIEdyb3VwOiBzdHJpbmcsIEdyb3VwS2V5OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5Ub2tlbiA9IFRva2VuO1xuICAgICAgICB0aGlzLkdyb3VwID0gR3JvdXA7XG4gICAgICAgIHRoaXMuR3JvdXBLZXkgPSBHcm91cEtleTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZnJvbVN0cmluZyhmcm9tOiBzdHJpbmcpOiBCYXRjaCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvID0gSlNPTi5wYXJzZShmcm9tKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IGIgPSBuZXcgQmF0Y2gobyk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmcm9tKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5Ub2tlbjtcbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIFRva2VuOiB0aGlzLlRva2VuLFxuICAgICAgICAgICAgR3JvdXA6IHRoaXMuR3JvdXAsXG4gICAgICAgICAgICBHcm91cEtleTogdGhpcy5Hcm91cEtleSxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgUXVlcnkge1xuICAgIG11c3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gICAgc2hvdWxkPzogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICAgIG11c3ROb3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlcXVlc3Qge1xuICAgIGtleXM6IEFycmF5PHN0cmluZz47XG4gICAgZmlsdGVyOiBRdWVyeTtcbiAgICBzb3J0Qnk6IFNlYXJjaE9yZGVyO1xuICAgIHNlYXJjaFRlcm06IHN0cmluZztcbiAgICBmcm9tOiBudW1iZXI7XG4gICAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBwYWdlU2l6ZSA9IDEwO1xuXG5pbnRlcmZhY2UgQmxldmVSZXNwb25zZVJvdyB7XG4gICAgcm9vbUlkOiBzdHJpbmc7XG4gICAgZXZlbnRJZDogc3RyaW5nO1xuICAgIHNjb3JlOiBudW1iZXI7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlIHtcbiAgICByb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PjtcbiAgICB0b3RhbDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXZlbnRMb29rdXBSZXN1bHQge1xuICAgIGV2ZW50OiBNYXRyaXhFdmVudDtcbiAgICBzY29yZTogbnVtYmVyO1xuICAgIHN0YXRlPzogQXJyYXk8TWF0cml4RXZlbnQ+O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBSZXN1bHQge1xuICAgIHJhbms6IG51bWJlcjtcbiAgICByZXN1bHQ6IEV2ZW50O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG59XG5cbmNsYXNzIFNlYXJjaCB7XG4gICAgY2xpOiBNYXRyaXhDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcihjbGk6IE1hdHJpeENsaWVudCkge1xuICAgICAgICB0aGlzLmNsaSA9IGNsaTtcbiAgICB9XG5cbiAgICAvLyBpbXBlZGFuY2UgbWF0Y2hpbmcuXG4gICAgYXN5bmMgcmVzb2x2ZU9uZShyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nLCBjb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dCk6IFByb21pc2U8W0V2ZW50LCBFdmVudENvbnRleHR8dW5kZWZpbmVkXT4ge1xuICAgICAgICBpZiAoY29udGV4dCkge1xuICAgICAgICAgICAgY29uc3QgbGltaXQgPSBNYXRoLm1heChjb250ZXh0LmFmdGVyX2xpbWl0IHx8IDAsIGNvbnRleHQuYmVmb3JlX2xpbWl0IHx8IDAsIDMpO1xuICAgICAgICAgICAgY29uc3QgZXZjID0gYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudENvbnRleHQocm9vbUlkLCBldmVudElkLCBsaW1pdCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHtzdGFydCwgZW5kLCBldmVudHNfYmVmb3JlLCBldmVudHNfYWZ0ZXIsIHN0YXRlfSA9IGV2Yy5jb250ZXh0O1xuICAgICAgICAgICAgY29uc3QgY3R4OiBFdmVudENvbnRleHQgPSB7XG4gICAgICAgICAgICAgICAgc3RhcnQsXG4gICAgICAgICAgICAgICAgZW5kLFxuICAgICAgICAgICAgICAgIHByb2ZpbGVfaW5mbzogbmV3IE1hcDxzdHJpbmcsIFVzZXJQcm9maWxlPigpLFxuICAgICAgICAgICAgICAgIGV2ZW50c19iZWZvcmU6IGV2ZW50c19iZWZvcmUubWFwKChldjogTWF0cml4RXZlbnQpID0+IGV2LmV2ZW50KSxcbiAgICAgICAgICAgICAgICBldmVudHNfYWZ0ZXI6IGV2ZW50c19hZnRlci5tYXAoKGV2OiBNYXRyaXhFdmVudCkgPT4gZXYuZXZlbnQpLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgdXNlcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIFsuLi5ldmVudHNfYmVmb3JlLCBldmMuZXZlbnQsIC4uLmV2ZW50c19hZnRlcl0uZm9yRWFjaCgoZXY6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgdXNlcnMuYWRkKGV2LmdldFNlbmRlcigpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBzdGF0ZS5mb3JFYWNoKChldjogRXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXYudHlwZSA9PT0gJ20ucm9vbS5tZW1iZXInICYmIHVzZXJzLmhhcyhldi5zdGF0ZV9rZXkpKVxuICAgICAgICAgICAgICAgICAgICBjdHgucHJvZmlsZV9pbmZvLnNldChldi5zdGF0ZV9rZXksIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3BsYXluYW1lOiBldi5jb250ZW50WydkaXNwbGF5bmFtZSddLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXZhdGFyX3VybDogZXYuY29udGVudFsnYXZhdGFyX3VybCddLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gW2V2Yy5ldmVudCwgY3R4XTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudChyb29tSWQsIGV2ZW50SWQpLCB1bmRlZmluZWRdO1xuICAgIH1cblxuICAgIGFzeW5jIHJlc29sdmUocm93czogQXJyYXk8QmxldmVSZXNwb25zZVJvdz4sIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxBcnJheTxFdmVudExvb2t1cFJlc3VsdD4+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+ID0gW107XG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGw8dm9pZD4ocm93cy5tYXAoYXN5bmMgKHJvdzogQmxldmVSZXNwb25zZVJvdyk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbZXYsIGN0eF0gPSBhd2FpdCB0aGlzLnJlc29sdmVPbmUocm93LnJvb21JZCwgcm93LmV2ZW50SWQsIGNvbnRleHQpO1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGV2ZW50OiBldixcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dDogY3R4LFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogcm93LnNjb3JlLFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiByb3cuaGlnaGxpZ2h0cyxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgIH0pKTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcGFyYW0ga2V5cyB7c3RyaW5nfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc2VhcmNoRmlsdGVyIHtGaWx0ZXJ9IGNvbXB1dGUgYW5kIHNlbmQgcXVlcnkgcnVsZXMgdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc29ydEJ5IHtTZWFyY2hPcmRlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIHNlYXJjaFRlcm0ge3N0cmluZ30gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGZyb20ge251bWJlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGNvbnRleHQ/IHtSZXF1ZXN0RXZlbnRDb250ZXh0fSBpZiBkZWZpbmVkIHVzZSB0byBmZXRjaCBjb250ZXh0IGFmdGVyIGdvLWJsZXZlIGNhbGxcbiAgICAgKi9cbiAgICBhc3luYyBxdWVyeShrZXlzOiBBcnJheTxzdHJpbmc+LCBzZWFyY2hGaWx0ZXI6IFNlYXJjaEZpbHRlciwgc29ydEJ5OiBTZWFyY2hPcmRlciwgc2VhcmNoVGVybTogc3RyaW5nLCBmcm9tOiBudW1iZXIsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+LCBudW1iZXJdPiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcjogUXVlcnkgPSB7fTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIGZpZWxkcyB3ZSB3aWxsIHVzZSAod2UgZG9uJ3QgdXNlIHNob3VsZCBjdXJyZW50bHkpXG4gICAgICAgIGZpbHRlci5tdXN0ID0gbmV3IE1hcCgpO1xuICAgICAgICBmaWx0ZXIubXVzdE5vdCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgcm9vbV9pZFxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdyb29tX2lkJywgc2VhcmNoRmlsdGVyLnJvb21zKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RSb29tcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0Tm90LnNldCgncm9vbV9pZCcsIHNlYXJjaEZpbHRlci5ub3RSb29tcyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHNlbmRlclxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3NlbmRlcicsIHNlYXJjaEZpbHRlci5zZW5kZXJzKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdzZW5kZXInLCBzZWFyY2hGaWx0ZXIubm90U2VuZGVycyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHR5cGVcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci50eXBlcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0LnNldCgndHlwZScsIHNlYXJjaEZpbHRlci50eXBlcyk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90VHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3R5cGUnLCBzZWFyY2hGaWx0ZXIubm90VHlwZXMpO1xuXG4gICAgICAgIGNvbnN0IHI6IEJsZXZlUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGZyb20sXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgZmlsdGVyLFxuICAgICAgICAgICAgc29ydEJ5LFxuICAgICAgICAgICAgc2VhcmNoVGVybSxcbiAgICAgICAgICAgIHNpemU6IHBhZ2VTaXplLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3A6IEJsZXZlUmVzcG9uc2UgPSBhd2FpdCBiLnNlYXJjaChyKTtcbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLnJlc29sdmUocmVzcC5yb3dzLCBjb250ZXh0KSwgcmVzcC50b3RhbF07XG4gICAgfVxufVxuXG5lbnVtIFNlYXJjaE9yZGVyIHtcbiAgICBSYW5rID0gJ3JhbmsnLFxuICAgIFJlY2VudCA9ICdyZWNlbnQnLFxufVxuXG5hc3luYyBmdW5jdGlvbiBzZXR1cCgpIHtcbiAgICBjb25zdCBhcmdzID0gYXJndi5ydW4oKTtcblxuICAgIGNvbnN0IGJhc2VVcmwgPSBhcmdzLm9wdGlvbnNbJ3VybCddIHx8ICdodHRwczovL21hdHJpeC5vcmcnO1xuXG4gICAgbGV0IGNyZWRzID0ge1xuICAgICAgICB1c2VySWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgndXNlcklkJyksXG4gICAgICAgIGRldmljZUlkOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2RldmljZUlkJyksXG4gICAgICAgIGFjY2Vzc1Rva2VuOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2FjY2Vzc1Rva2VuJyksXG4gICAgfTtcblxuICAgIGlmICghY3JlZHMudXNlcklkIHx8ICFjcmVkcy5kZXZpY2VJZCB8fCAhY3JlZHMuYWNjZXNzVG9rZW4pIHtcbiAgICAgICAgaWYgKCFhcmdzLm9wdGlvbnNbJ3VzZXJuYW1lJ10gfHwgIWFyZ3Mub3B0aW9uc1sncGFzc3dvcmQnXSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1VzZXJuYW1lIGFuZCBQYXNzd29yZCB3ZXJlIG5vdCBzcGVjaWZpZWQgb24gdGhlIGNvbW1hbmRsaW5lIGFuZCBub25lIHdlcmUgc2F2ZWQnKTtcbiAgICAgICAgICAgIGFyZ3YuaGVscCgpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KC0xKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvZ2luQ2xpZW50OiBNYXRyaXhDbGllbnQgPSBjcmVhdGVDbGllbnQoe2Jhc2VVcmx9KTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgbG9naW5DbGllbnQubG9naW4oJ20ubG9naW4ucGFzc3dvcmQnLCB7XG4gICAgICAgICAgICAgICAgdXNlcjogYXJncy5vcHRpb25zWyd1c2VybmFtZSddLFxuICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBhcmdzLm9wdGlvbnNbJ3Bhc3N3b3JkJ10sXG4gICAgICAgICAgICAgICAgaW5pdGlhbF9kZXZpY2VfZGlzcGxheV9uYW1lOiAnTWF0cml4IFNlYXJjaCBEYWVtb24nLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdMb2dnZWQgaW4gYXMgJyArIHJlcy51c2VyX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgndXNlcklkJywgcmVzLnVzZXJfaWQpO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdkZXZpY2VJZCcsIHJlcy5kZXZpY2VfaWQpO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdhY2Nlc3NUb2tlbicsIHJlcy5hY2Nlc3NfdG9rZW4pO1xuXG4gICAgICAgICAgICBjcmVkcyA9IHtcbiAgICAgICAgICAgICAgICB1c2VySWQ6IHJlcy51c2VyX2lkLFxuICAgICAgICAgICAgICAgIGRldmljZUlkOiByZXMuZGV2aWNlX2lkLFxuICAgICAgICAgICAgICAgIGFjY2Vzc1Rva2VuOiByZXMuYWNjZXNzX3Rva2VuLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnQW4gZXJyb3Igb2NjdXJlZCBsb2dnaW5nIGluIScpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coZXJyKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNsaTogTWF0cml4Q2xpZW50ID0gY3JlYXRlQ2xpZW50KHtcbiAgICAgICAgYmFzZVVybCxcbiAgICAgICAgaWRCYXNlVXJsOiAnJyxcbiAgICAgICAgLi4uY3JlZHMsXG4gICAgICAgIHVzZUF1dGhvcml6YXRpb25IZWFkZXI6IHRydWUsXG4gICAgICAgIHN0b3JlOiBuZXcgTWF0cml4SW5NZW1vcnlTdG9yZSh7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2U6IGdsb2JhbC5sb2NhbFN0b3JhZ2UsXG4gICAgICAgIH0pLFxuICAgICAgICBzZXNzaW9uU3RvcmU6IG5ldyBXZWJTdG9yYWdlU2Vzc2lvblN0b3JlKGdsb2JhbC5sb2NhbFN0b3JhZ2UpLFxuICAgIH0pO1xuXG4gICAgY2xpLm9uKCdldmVudCcsIChldmVudDogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmlzRW5jcnlwdGVkKCkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBjZXYgPSBldmVudC5nZXRDbGVhckV2ZW50KCk7XG4gICAgICAgIC8vIGlmIGV2ZW50IGNhbiBiZSByZWRhY3RlZCBvciBpcyBhIHJlZGFjdGlvbiB0aGVuIGVucXVldWUgaXQgZm9yIHByb2Nlc3NpbmdcbiAgICAgICAgaWYgKGV2ZW50LmdldFR5cGUoKSA9PT0gXCJtLnJvb20ucmVkYWN0aW9uXCIgfHwgIWluZGV4YWJsZShjZXYpKSByZXR1cm47XG4gICAgICAgIHJldHVybiBxLnB1c2goY2V2KTtcbiAgICB9KTtcbiAgICBjbGkub24oJ0V2ZW50LmRlY3J5cHRlZCcsIChldmVudDogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmlzRGVjcnlwdGlvbkZhaWx1cmUoKSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGV2ZW50LmV2ZW50KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNldiA9IGV2ZW50LmdldENsZWFyRXZlbnQoKTtcbiAgICAgICAgaWYgKCFpbmRleGFibGUoY2V2KSkgcmV0dXJuO1xuICAgICAgICByZXR1cm4gcS5wdXNoKGNldik7XG4gICAgfSk7XG5cbiAgICAvLyBjbGkub24oJ1Jvb20ucmVkYWN0aW9uJywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgIC8vICAgICByZXR1cm4gcS5wdXNoKHtcbiAgICAvLyAgICAgICAgIHR5cGU6IEpvYlR5cGUucmVkYWN0LFxuICAgIC8vICAgICAgICAgZXZlbnQ6IGV2ZW50LmdldENsZWFyRXZlbnQoKSxcbiAgICAvLyAgICAgfSk7XG4gICAgLy8gfSk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmluZm8oXCJpbml0aWFsaXppbmcgY3J5cHRvXCIpO1xuICAgICAgICBhd2FpdCBjbGkuaW5pdENyeXB0bygpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBpbml0IGNyeXB0by5cIik7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gICAgfVxuICAgIGNvbnNvbGUuaW5mbyhcImNyeXB0byBpbml0aWFsaXplZFwiKTtcblxuICAgIC8vIGNyZWF0ZSBzeW5jIGZpbHRlclxuICAgIGNvbnN0IGZpbHRlciA9IG5ldyBGaWx0ZXIoY2xpLmNyZWRlbnRpYWxzLnVzZXJJZCk7XG4gICAgZmlsdGVyLnNldERlZmluaXRpb24oe1xuICAgICAgICByb29tOiB7XG4gICAgICAgICAgICBpbmNsdWRlX2xlYXZlOiBmYWxzZSwgLy8gVE9ETzogbm90IHN1cmUgaGVyZVxuICAgICAgICAgICAgZXBoZW1lcmFsOiB7IC8vIHdlIGRvbid0IGNhcmUgYWJvdXQgZXBoZW1lcmFsIGV2ZW50c1xuICAgICAgICAgICAgICAgIGxpbWl0OiAwLFxuICAgICAgICAgICAgICAgIHR5cGVzOiBbXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhY2NvdW50X2RhdGE6IHsgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCByb29tIGFjY291bnRfZGF0YVxuICAgICAgICAgICAgICAgIGxpbWl0OiAwLFxuICAgICAgICAgICAgICAgIHR5cGVzOiBbXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBzdGF0ZTogeyAvLyBUT0RPOiBkbyB3ZSBjYXJlIGFib3V0IHN0YXRlXG4gICAgICAgICAgICAvLyAgICAgbGltaXQ6IDAsXG4gICAgICAgICAgICAvLyAgICAgdHlwZXM6IFtdLFxuICAgICAgICAgICAgLy8gfSxcbiAgICAgICAgICAgIC8vIHRpbWVsaW5lOiB7IC8vIFRPRE8gZG8gd2Ugd2FudCBhbGwgdGltZWxpbmUgZXZzXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gfVxuICAgICAgICB9LFxuICAgICAgICBwcmVzZW5jZTogeyAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IHByZXNlbmNlXG4gICAgICAgICAgICBsaW1pdDogMCxcbiAgICAgICAgICAgIHR5cGVzOiBbXSxcbiAgICAgICAgfSxcbiAgICAgICAgYWNjb3VudF9kYXRhOiB7IC8vIHdlIGRvbid0IGNhcmUgYWJvdXQgZ2xvYmFsIGFjY291bnRfZGF0YVxuICAgICAgICAgICAgbGltaXQ6IDAsXG4gICAgICAgICAgICB0eXBlczogW10sXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmluZm8oXCJsb2FkaW5nL2NyZWF0aW5nIHN5bmMgZmlsdGVyXCIpO1xuICAgICAgICBmaWx0ZXIuZmlsdGVySWQgPSBhd2FpdCBjbGkuZ2V0T3JDcmVhdGVGaWx0ZXIoZmlsdGVyTmFtZShjbGkpLCBmaWx0ZXIpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBnZXRPckNyZWF0ZSBzeW5jIGZpbHRlci5cIik7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gICAgfVxuICAgIGNvbnNvbGUuaW5mbyhcInN5bmMgZmlsdGVyIGxvYWRlZFwiKTtcblxuICAgIGNvbnNvbGUuaW5mbyhcInN0YXJ0aW5nIGNsaWVudFwiKTtcbiAgICAvLyBmaWx0ZXIgc3luYyB0byBpbXByb3ZlIHBlcmZvcm1hbmNlXG4gICAgY2xpLnN0YXJ0Q2xpZW50KHtcbiAgICAgICAgZGlzYWJsZVByZXNlbmNlOiB0cnVlLFxuICAgICAgICBmaWx0ZXIsXG4gICAgfSk7XG4gICAgY29uc29sZS5pbmZvKFwiY2xpZW50IHN0YXJ0ZWRcIik7XG5cbiAgICBjb25zdCBhcHAgPSBleHByZXNzKCk7XG4gICAgYXBwLnVzZShib2R5UGFyc2VyLmpzb24oKSk7XG4gICAgYXBwLnVzZShjb3JzKHtcbiAgICAgICAgJ2FsbG93ZWRIZWFkZXJzJzogWydhY2Nlc3NfdG9rZW4nLCAnQ29udGVudC1UeXBlJ10sXG4gICAgICAgICdleHBvc2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJ10sXG4gICAgICAgICdvcmlnaW4nOiAnKicsXG4gICAgICAgICdtZXRob2RzJzogJ1BPU1QnLFxuICAgICAgICAncHJlZmxpZ2h0Q29udGludWUnOiBmYWxzZVxuICAgIH0pKTtcblxuICAgIGFwcC5wb3N0KCcvc2VhcmNoJywgYXN5bmMgKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoIXJlcS5ib2R5KSB7XG4gICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg0MDApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IG5leHRCYXRjaDogQmF0Y2ggfCBudWxsID0gbnVsbDtcbiAgICAgICAgaWYgKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG5leHRCYXRjaCA9IEpTT04ucGFyc2UoZ2xvYmFsLmF0b2IocmVxLnF1ZXJ5WyduZXh0X2JhdGNoJ10pKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmluZm8oXCJGb3VuZCBuZXh0IGJhdGNoIG9mXCIsIG5leHRCYXRjaCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBwYXJzZSBuZXh0X2JhdGNoIGFyZ3VtZW50XCIsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gdmVyaWZ5IHRoYXQgdXNlciBpcyBhbGxvd2VkIHRvIGFjY2VzcyB0aGlzIHRoaW5nXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjYXN0Qm9keTogTWF0cml4U2VhcmNoUmVxdWVzdCA9IHJlcS5ib2R5O1xuICAgICAgICAgICAgY29uc3Qgcm9vbUNhdCA9IGNhc3RCb2R5LnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzO1xuXG4gICAgICAgICAgICBpZiAoIXJvb21DYXQpIHtcbiAgICAgICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDEpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGtleXM6IEFycmF5PFJlcXVlc3RLZXk+ID0gW1JlcXVlc3RLZXkuYm9keSwgUmVxdWVzdEtleS5uYW1lLCBSZXF1ZXN0S2V5LnRvcGljXTsgLy8gZGVmYXVsdCB2YWx1ZSBmb3Igcm9vbUNhdC5rZXlcbiAgICAgICAgICAgIGlmIChyb29tQ2F0LmtleXMgJiYgcm9vbUNhdC5rZXlzLmxlbmd0aCkga2V5cyA9IHJvb21DYXQua2V5cztcblxuICAgICAgICAgICAgY29uc3QgaW5jbHVkZVN0YXRlID0gQm9vbGVhbihyb29tQ2F0WydpbmNsdWRlX3N0YXRlJ10pO1xuICAgICAgICAgICAgY29uc3QgZXZlbnRDb250ZXh0ID0gcm9vbUNhdFsnZXZlbnRfY29udGV4dCddO1xuXG4gICAgICAgICAgICBsZXQgZ3JvdXBCeVJvb21JZCA9IGZhbHNlO1xuICAgICAgICAgICAgbGV0IGdyb3VwQnlTZW5kZXIgPSBmYWxzZTtcbiAgICAgICAgICAgIGlmIChyb29tQ2F0Lmdyb3VwaW5ncyAmJiByb29tQ2F0Lmdyb3VwaW5ncy5ncm91cF9ieSkge1xuICAgICAgICAgICAgICAgIHJvb21DYXQuZ3JvdXBpbmdzLmdyb3VwX2J5LmZvckVhY2goZ3JvdXBpbmcgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGdyb3VwaW5nLmtleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSBSZXF1ZXN0R3JvdXBLZXkucm9vbUlkOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQnlSb29tSWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSBSZXF1ZXN0R3JvdXBLZXkuc2VuZGVyOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQnlTZW5kZXIgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlciA9IG5ldyBTZWFyY2hGaWx0ZXIocm9vbUNhdC5maWx0ZXIgfHwge30pOyAvLyBkZWZhdWx0IHRvIGVtcHR5IG9iamVjdCB0byBhc3N1bWUgZGVmYXVsdHNcblxuICAgICAgICAgICAgLy8gVE9ETyB0aGlzIGlzIHJlbW92ZWQgYmVjYXVzZSByb29tcyBzdG9yZSBpcyB1bnJlbGlhYmxlIEFGXG4gICAgICAgICAgICAvLyBjb25zdCBqb2luZWRSb29tcyA9IGNsaS5nZXRSb29tcygpO1xuICAgICAgICAgICAgLy8gY29uc3Qgcm9vbUlkcyA9IGpvaW5lZFJvb21zLm1hcCgocm9vbTogUm9vbSkgPT4gcm9vbS5yb29tSWQpO1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIGlmIChyb29tSWRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgIC8vICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAvLyAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vICAgICB9KTtcbiAgICAgICAgICAgIC8vICAgICByZXR1cm47XG4gICAgICAgICAgICAvLyB9XG5cbiAgICAgICAgICAgIC8vIFNLSVAgZm9yIG5vd1xuICAgICAgICAgICAgLy8gbGV0IHJvb21JZHNTZXQgPSBzZWFyY2hGaWx0ZXIuZmlsdGVyUm9vbXMocm9vbUlkcyk7XG5cbiAgICAgICAgICAgIC8vIGlmIChiLmlzR3JvdXBpbmcoXCJyb29tX2lkXCIpKSB7XG4gICAgICAgICAgICAvLyAgICAgcm9vbUlEc1NldC5JbnRlcnNlY3QoY29tbW9uLk5ld1N0cmluZ1NldChbXXN0cmluZ3sqYi5Hcm91cEtleX0pKVxuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICAvLyBUT0RPIGRvIHdlIG5lZWQgdGhpc1xuICAgICAgICAgICAgLy9yYW5rTWFwIDo9IG1hcFtzdHJpbmddZmxvYXQ2NHt9XG4gICAgICAgICAgICAvL2FsbG93ZWRFdmVudHMgOj0gW10qUmVzdWx0e31cbiAgICAgICAgICAgIC8vIFRPRE8gdGhlc2UgbmVlZCBjaGFuZ2luZ1xuICAgICAgICAgICAgY29uc3Qgcm9vbUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuICAgICAgICAgICAgY29uc3Qgc2VuZGVyR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+KCk7XG5cbiAgICAgICAgICAgIGxldCBnbG9iYWxOZXh0QmF0Y2g6IHN0cmluZ3x1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21zID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaCA9IG5ldyBTZWFyY2goY2xpKTtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaFRlcm0gPSByb29tQ2F0WydzZWFyY2hfdGVybSddO1xuXG4gICAgICAgICAgICBsZXQgYWxsb3dlZEV2ZW50czogQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+O1xuICAgICAgICAgICAgbGV0IGNvdW50OiBudW1iZXIgPSAwO1xuXG4gICAgICAgICAgICAvLyBUT0RPIGV4dGVuZCBsb2NhbCBldmVudCBtYXAgdXNpbmcgc3FsaXRlL2xldmVsZGJcbiAgICAgICAgICAgIHN3aXRjaCAocm9vbUNhdFsnb3JkZXJfYnknXSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3JhbmsnOlxuICAgICAgICAgICAgICAgIGNhc2UgJyc6XG4gICAgICAgICAgICAgICAgICAgIC8vIGdldCBtZXNzYWdlcyBmcm9tIEJsZXZlIGJ5IHJhbmsgLy8gcmVzb2x2ZSB0aGVtIGxvY2FsbHlcbiAgICAgICAgICAgICAgICAgICAgW2FsbG93ZWRFdmVudHMsIGNvdW50XSA9IGF3YWl0IHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJhbmssIHNlYXJjaFRlcm0sIDAsIGV2ZW50Q29udGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAncmVjZW50JzpcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbSA9IG5leHRCYXRjaCAhPT0gbnVsbCA/IG5leHRCYXRjaC5mcm9tKCkgOiAwO1xuICAgICAgICAgICAgICAgICAgICBbYWxsb3dlZEV2ZW50cywgY291bnRdID0gYXdhaXQgc2VhcmNoLnF1ZXJ5KGtleXMsIHNlYXJjaEZpbHRlciwgU2VhcmNoT3JkZXIuUmVjZW50LCBzZWFyY2hUZXJtLCBmcm9tLCBldmVudENvbnRleHQpO1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPIGdldCBuZXh0IGJhY2sgaGVyZVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIHJlcy5zZW5kU3RhdHVzKDUwMSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGFsbG93ZWRFdmVudHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgICAgIHJlcy5qc29uKHtcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvb21fZXZlbnRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogW10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0czogW10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY291bnQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaGlnaGxpZ2h0c1N1cGVyc2V0ID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTxSZXN1bHQ+ID0gW107XG5cbiAgICAgICAgICAgIGFsbG93ZWRFdmVudHMuZm9yRWFjaCgocm93OiBFdmVudExvb2t1cFJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhbGN1bGF0ZSBoaWdodGxpZ2h0c1N1cGVyc2V0XG4gICAgICAgICAgICAgICAgcm93LmhpZ2hsaWdodHMuZm9yRWFjaCgoaGlnaGxpZ2h0OiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0c1N1cGVyc2V0LmFkZChoaWdobGlnaHQpO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qge2V2ZW50OiBldn0gPSByb3c7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdiA9IHJvb21Hcm91cHMuZ2V0KGV2LmdldFJvb21JZCgpKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF2KSB2ID0gbmV3IEdyb3VwVmFsdWUocm93LnNjb3JlKTtcbiAgICAgICAgICAgICAgICAgICAgdi5hZGQoZXYuZ2V0SWQoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJvb21Hcm91cHMuc2V0KGV2LmdldFJvb21JZCgpLCB2KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlTZW5kZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHYgPSBzZW5kZXJHcm91cHMuZ2V0KGV2LmdldFNlbmRlcigpKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF2KSB2ID0gbmV3IEdyb3VwVmFsdWUocm93LnNjb3JlKTtcbiAgICAgICAgICAgICAgICAgICAgdi5hZGQoZXYuZ2V0SWQoKSk7XG4gICAgICAgICAgICAgICAgICAgIHNlbmRlckdyb3Vwcy5zZXQoZXYuZ2V0U2VuZGVyKCksIHYpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJvb21zLmFkZChldi5nZXRSb29tSWQoKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBhZGQgdG8gcmVzdWx0cyBhcnJheVxuICAgICAgICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA8IHNlYXJjaEZpbHRlci5saW1pdClcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJhbms6IHJvdy5zY29yZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdDogcm93LmV2ZW50LmV2ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGV4dDogcm93LmNvbnRleHQsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgcm9vbVN0YXRlTWFwID0gbmV3IE1hcDxzdHJpbmcsIEFycmF5PE1hdHJpeEV2ZW50Pj4oKTtcbiAgICAgICAgICAgIGlmIChpbmNsdWRlU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAvLyBUT0RPIGZldGNoIHN0YXRlIGZyb20gc2VydmVyIHVzaW5nIEFQSSBiZWNhdXNlIGpzLXNkayBpcyBicm9rZW4gZHVlIHRvIHN0b3JlXG4gICAgICAgICAgICAgICAgcm9vbXMuZm9yRWFjaCgocm9vbUlkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm9vbSA9IGNsaS5nZXRSb29tKHJvb21JZCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyb29tKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tU3RhdGVNYXAuc2V0KHJvb21JZCwgcm9vbS5jdXJyZW50U3RhdGUucmVkdWNlKChhY2MsIG1hcDogTWFwPHN0cmluZywgTWF0cml4RXZlbnQ+KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwLmZvckVhY2goKGV2OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY2MucHVzaChldik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sIFtdKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcmVzcDogTWF0cml4U2VhcmNoUmVzcG9uc2UgPSB7XG4gICAgICAgICAgICAgICAgc2VhcmNoX2NhdGVnb3JpZXM6IHt9LFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIHNwbGl0IHRvIG1ha2UgVHlwZVNjcmlwdCBoYXBweSB3aXRoIHRoZSBpZiBzdGF0ZW1lbnRzIGZvbGxvd2luZ1xuICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cyA9IHtcbiAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBoaWdobGlnaHRzU3VwZXJzZXQsXG4gICAgICAgICAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgICAgICAgICBjb3VudCxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIG9taXRlbXB0eSBiZWhhdmlvdXIgdXNpbmcgaWYgdG8gYXR0YWNoIG9udG8gb2JqZWN0IHRvIGJlIHNlcmlhbGl6ZWRcbiAgICAgICAgICAgIGlmIChnbG9iYWxOZXh0QmF0Y2gpIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMubmV4dF9iYXRjaCA9IGdsb2JhbE5leHRCYXRjaDtcbiAgICAgICAgICAgIGlmIChpbmNsdWRlU3RhdGUpIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuc3RhdGUgPSByb29tU3RhdGVNYXA7XG5cbiAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkIHx8IGdyb3VwQnlTZW5kZXIpIHtcbiAgICAgICAgICAgICAgICByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLmdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPj4oKTtcblxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZUdyb3VwVmFsdWVPcmRlcihyb29tR3JvdXBzLnZhbHVlcygpKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5ncm91cHMuc2V0KFJlcXVlc3RHcm91cEtleS5yb29tSWQsIHJvb21Hcm91cHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVNlbmRlcikge1xuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIoc2VuZGVyR3JvdXBzLnZhbHVlcygpKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5ncm91cHMuc2V0KFJlcXVlc3RHcm91cEtleS5zZW5kZXIsIHNlbmRlckdyb3Vwcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgIHJlcy5zdGF0dXMoMjAwKTtcbiAgICAgICAgICAgIHJlcy5qc29uKHJlc3ApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkNhdGFzdHJvcGhlXCIsIGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAwKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHBvcnQgPSBhcmdzLm9wdGlvbnNbJ3BvcnQnXSB8fCA4MDAwO1xuICAgIGFwcC5saXN0ZW4ocG9ydCwgKCkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhgV2UgYXJlIGxpdmUgb24gJHtwb3J0fWApO1xuICAgIH0pO1xufVxuXG4vLyBUT0RPIHBhZ2luYXRpb25cbi8vIFRPRE8gZ3JvdXBzLXBhZ2luYXRpb25cbi8vIFRPRE8gYmFja2ZpbGxcblxuZnVuY3Rpb24gZmlsdGVyTmFtZShjbGk6IE1hdHJpeENsaWVudCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBNQVRSSVhfU0VBUkNIX0ZJTFRFUl8ke2NsaS5jcmVkZW50aWFscy51c2VySWR9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplR3JvdXBWYWx1ZU9yZGVyKGl0OiBJdGVyYWJsZUl0ZXJhdG9yPEdyb3VwVmFsdWU+KSB7XG4gICAgbGV0IGkgPSAxO1xuICAgIEFycmF5LmZyb20oaXQpLnNvcnQoKGE6IEdyb3VwVmFsdWUsIGI6IEdyb3VwVmFsdWUpID0+IGEub3JkZXItYi5vcmRlcikuZm9yRWFjaCgoZzogR3JvdXBWYWx1ZSkgPT4ge1xuICAgICAgICAvLyBub3JtYWxpemUgb3JkZXIgYmFzZWQgb24gc29ydCBieSBmbG9hdFxuICAgICAgICBnLm9yZGVyID0gaSsrO1xuICAgIH0pO1xufVxuXG5jbGFzcyBTZWFyY2hGaWx0ZXIge1xuICAgIHJvb21zOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RSb29tczogU2V0PHN0cmluZz47XG4gICAgc2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgbm90U2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgdHlwZXM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFR5cGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBsaW1pdDogbnVtYmVyO1xuICAgIGNvbnRhaW5zVVJMOiBib29sZWFuIHwgdW5kZWZpbmVkO1xuXG4gICAgY29uc3RydWN0b3Iobzogb2JqZWN0KSB7XG4gICAgICAgIHRoaXMucm9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1sncm9vbXMnXSk7XG4gICAgICAgIHRoaXMubm90Um9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3Jvb21zJ10pO1xuICAgICAgICB0aGlzLnNlbmRlcnMgPSBuZXcgU2V0PHN0cmluZz4ob1snc2VuZGVycyddKTtcbiAgICAgICAgdGhpcy5ub3RTZW5kZXJzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF9zZW5kZXJzJ10pO1xuICAgICAgICB0aGlzLnR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ3R5cGVzJ10pO1xuICAgICAgICB0aGlzLm5vdFR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF90eXBlcyddKTtcblxuICAgICAgICB0aGlzLmxpbWl0ID0gdHlwZW9mIG9bJ2xpbWl0J10gPT09IFwibnVtYmVyXCIgPyBvWydsaW1pdCddIDogMTA7XG4gICAgICAgIHRoaXMuY29udGFpbnNVUkwgPSBvWydjb250YWluc191cmwnXTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBSZXF1ZXN0RXZlbnRDb250ZXh0IHtcbiAgICBiZWZvcmVfbGltaXQ/OiBudW1iZXI7XG4gICAgYWZ0ZXJfbGltaXQ/OiBudW1iZXI7XG4gICAgaW5jbHVkZV9wcm9maWxlOiBib29sZWFuO1xufVxuXG5lbnVtIFJlcXVlc3RHcm91cEtleSB7XG4gICAgcm9vbUlkID0gXCJyb29tX2lkXCIsXG4gICAgc2VuZGVyID0gXCJzZW5kZXJcIixcbn1cblxuaW50ZXJmYWNlIFJlcXVlc3RHcm91cCB7XG4gICAga2V5OiBSZXF1ZXN0R3JvdXBLZXk7XG59XG5cbmludGVyZmFjZSBSZXF1ZXN0R3JvdXBzIHtcbiAgICBncm91cF9ieT86IEFycmF5PFJlcXVlc3RHcm91cD47XG59XG5cbmVudW0gUmVxdWVzdEtleSB7XG4gICAgYm9keSA9IFwiY29udGVudC5ib2R5XCIsXG4gICAgbmFtZSA9IFwiY29udGVudC5uYW1lXCIsXG4gICAgdG9waWMgPSBcImNvbnRlbnQudG9waWNcIixcbn1cblxuY29uc3QgaW5kZXhhYmxlS2V5cyA9IFtSZXF1ZXN0S2V5LmJvZHksIFJlcXVlc3RLZXkubmFtZSwgUmVxdWVzdEtleS50b3BpY107XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXF1ZXN0Qm9keSB7XG4gICAgc2VhcmNoX3Rlcm06IHN0cmluZztcbiAgICBrZXlzPzogQXJyYXk8UmVxdWVzdEtleT47XG4gICAgZmlsdGVyPzogb2JqZWN0OyAvLyB0aGlzIGdldHMgaW5mbGF0ZWQgdG8gYW4gaW5zdGFuY2Ugb2YgRmlsdGVyXG4gICAgb3JkZXJfYnk/OiBzdHJpbmc7XG4gICAgZXZlbnRfY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQ7XG4gICAgaW5jbHVkZVN0YXRlPzogYm9vbGVhbjtcbiAgICBncm91cGluZ3M/OiBSZXF1ZXN0R3JvdXBzO1xufVxuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVxdWVzdCB7XG4gICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgcm9vbV9ldmVudHM/OiBNYXRyaXhTZWFyY2hSZXF1ZXN0Qm9keTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXNwb25zZSB7XG4gICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgcm9vbV9ldmVudHM/OiB7XG4gICAgICAgICAgICBjb3VudDogbnVtYmVyO1xuICAgICAgICAgICAgcmVzdWx0czogQXJyYXk8UmVzdWx0PjtcbiAgICAgICAgICAgIGhpZ2hsaWdodHM6IFNldDxzdHJpbmc+O1xuICAgICAgICAgICAgc3RhdGU/OiBNYXA8c3RyaW5nLCBBcnJheTxFdmVudD4+O1xuICAgICAgICAgICAgZ3JvdXBzPzogTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+O1xuICAgICAgICAgICAgbmV4dF9iYXRjaD86IHN0cmluZztcbiAgICAgICAgfVxuICAgIH1cbn0iXX0=