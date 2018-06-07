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
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const mkdirp = __importStar(require("mkdirp"));
const Queue = require('better-queue');
const SqliteStore = require('better-queue-sqlite');
const request = require('request-promise');
const LocalStorageCryptoStore = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store').default;
// create directory which will house the stores.
mkdirp.sync('./store');
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store/localStorage');
// import Olm before importing js-sdk to prevent it crying
global.Olm = require('olm');
const matrix_js_sdk_1 = require("matrix-js-sdk");
// side-effect upgrade MatrixClient prototype
require("./matrix_client_ext");
// side-effect upgrade Map and Set prototypes
require("./builtin_ext");
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
        this.request = request.defaults({
            baseUrl,
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
    index(events) {
        return this.request({
            url: 'index',
            method: 'PUT',
            json: true,
            body: events,
        });
    }
}
const b = new BleveHttp("http://localhost:9999/api/");
const q = new Queue(async (batch, cb) => {
    try {
        cb(null, await b.index(batch));
    }
    catch (e) {
        cb(e);
    }
}, {
    batchSize: 100,
    maxRetries: 10,
    retryDelay: 1000,
    store: new SqliteStore({
        path: './store/queue.sqlite',
    }),
    filter: (event, cb) => {
        if (event.type !== 'm.room.message')
            return cb('not m.room.message');
        return cb(null, event);
    }
});
q.on('task_accepted', function (taskId, ev) {
    console.info(`Enqueue event ${ev.room_id}/${ev.event_id} ${ev.sender} [${ev.type}] (${taskId})`);
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
        return q.push(event.getClearEvent());
    });
    cli.on('Event.decrypted', (event) => {
        if (event.isDecryptionFailure()) {
            console.warn(event.event);
            return;
        }
        return q.push(event.getClearEvent());
    });
    try {
        await cli.initCrypto();
    }
    catch (e) {
        console.log(e);
    }
    cli.startClient();
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
            const searchFilter = new Filter(roomCat.filter || {}); // default to empty object to assume defaults
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
function normalizeGroupValueOrder(it) {
    let i = 1;
    Array.from(it).sort((a, b) => a.order - b.order).forEach((g) => {
        // normalize order based on sort by float
        g.order = i++;
    });
}
class Filter {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFRQSxnREFBd0I7QUFFeEIsZ0RBQXdCO0FBQ3hCLHNEQUFtRDtBQUNuRCw4REFBcUM7QUFDckMsK0NBQWlDO0FBSWpDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUN0QyxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUNuRCxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUUzQyxNQUFNLHVCQUF1QixHQUFHLE9BQU8sQ0FBQywwREFBMEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQztBQUU1RyxnREFBZ0Q7QUFDaEQsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN2Qiw4QkFBOEI7QUFDOUIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxZQUFZLEtBQUssV0FBVyxJQUFJLE1BQU0sQ0FBQyxZQUFZLEtBQUssSUFBSTtJQUMxRSxNQUFNLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBRWxHLDBEQUEwRDtBQUMxRCxNQUFNLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUU1QixpREFhdUI7QUFFdkIsNkNBQTZDO0FBQzdDLCtCQUE2QjtBQUM3Qiw2Q0FBNkM7QUFDN0MseUJBQXVCO0FBRXZCLHFDQUFxQixDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksdUJBQXVCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFFOUUsY0FBSSxDQUFDLE1BQU0sQ0FBQztJQUNSO1FBQ0ksSUFBSSxFQUFFLEtBQUs7UUFDWCxJQUFJLEVBQUUsUUFBUTtRQUNkLFdBQVcsRUFBRSxn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QUFDLEVBSEksZUFBZSxLQUFmLGVBQWUsUUFHbkI7QUFVRCxJQUFLLFVBSUo7QUFKRCxXQUFLLFVBQVU7SUFDWCxtQ0FBcUIsQ0FBQTtJQUNyQixtQ0FBcUIsQ0FBQTtJQUNyQixxQ0FBdUIsQ0FBQTtBQUMzQixDQUFDLEVBSkksVUFBVSxLQUFWLFVBQVUsUUFJZCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7RXZlbnRDb250ZXh0LCBVc2VyUHJvZmlsZX0gZnJvbSBcIi4vdHlwaW5ncy9tYXRyaXgtanMtc2RrXCI7XG5cbmRlY2xhcmUgdmFyIGdsb2JhbDoge1xuICAgIE9sbTogYW55XG4gICAgbG9jYWxTdG9yYWdlPzogYW55XG4gICAgYXRvYjogKHN0cmluZykgPT4gc3RyaW5nO1xufTtcblxuaW1wb3J0IGFyZ3YgZnJvbSAnYXJndic7XG5pbXBvcnQge1JlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnN9IGZyb20gXCJyZXF1ZXN0LXByb21pc2VcIjtcbmltcG9ydCBjb3JzIGZyb20gJ2NvcnMnO1xuaW1wb3J0IGV4cHJlc3MsIHtSZXF1ZXN0LCBSZXNwb25zZX0gZnJvbSBcImV4cHJlc3NcIjtcbmltcG9ydCBib2R5UGFyc2VyIGZyb20gJ2JvZHktcGFyc2VyJztcbmltcG9ydCAqIGFzIG1rZGlycCBmcm9tIFwibWtkaXJwXCI7XG5cbmltcG9ydCB7UmVxdWVzdEFQSSwgUmVxdWlyZWRVcmlVcmx9IGZyb20gXCJyZXF1ZXN0XCI7XG5cbmNvbnN0IFF1ZXVlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlJyk7XG5jb25zdCBTcWxpdGVTdG9yZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZS1zcWxpdGUnKTtcbmNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0LXByb21pc2UnKTtcblxuY29uc3QgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL2xpYi9jcnlwdG8vc3RvcmUvbG9jYWxTdG9yYWdlLWNyeXB0by1zdG9yZScpLmRlZmF1bHQ7XG5cbi8vIGNyZWF0ZSBkaXJlY3Rvcnkgd2hpY2ggd2lsbCBob3VzZSB0aGUgc3RvcmVzLlxubWtkaXJwLnN5bmMoJy4vc3RvcmUnKTtcbi8vIExvYWRpbmcgbG9jYWxTdG9yYWdlIG1vZHVsZVxuaWYgKHR5cGVvZiBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBcInVuZGVmaW5lZFwiIHx8IGdsb2JhbC5sb2NhbFN0b3JhZ2UgPT09IG51bGwpXG4gICAgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9IG5ldyAocmVxdWlyZSgnbm9kZS1sb2NhbHN0b3JhZ2UnKS5Mb2NhbFN0b3JhZ2UpKCcuL3N0b3JlL2xvY2FsU3RvcmFnZScpO1xuXG4vLyBpbXBvcnQgT2xtIGJlZm9yZSBpbXBvcnRpbmcganMtc2RrIHRvIHByZXZlbnQgaXQgY3J5aW5nXG5nbG9iYWwuT2xtID0gcmVxdWlyZSgnb2xtJyk7XG5cbmltcG9ydCB7XG4gICAgUm9vbSxcbiAgICBFdmVudCxcbiAgICBNYXRyaXgsXG4gICAgTWF0cml4RXZlbnQsXG4gICAgY3JlYXRlQ2xpZW50LFxuICAgIE1hdHJpeENsaWVudCxcbiAgICBJbmRleGVkREJTdG9yZSxcbiAgICBFdmVudFdpdGhDb250ZXh0LFxuICAgIE1hdHJpeEluTWVtb3J5U3RvcmUsXG4gICAgSW5kZXhlZERCQ3J5cHRvU3RvcmUsXG4gICAgc2V0Q3J5cHRvU3RvcmVGYWN0b3J5LFxuICAgIFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUsXG59IGZyb20gJ21hdHJpeC1qcy1zZGsnO1xuXG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hdHJpeENsaWVudCBwcm90b3R5cGVcbmltcG9ydCAnLi9tYXRyaXhfY2xpZW50X2V4dCc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hcCBhbmQgU2V0IHByb3RvdHlwZXNcbmltcG9ydCAnLi9idWlsdGluX2V4dCc7XG5cbnNldENyeXB0b1N0b3JlRmFjdG9yeSgoKSA9PiBuZXcgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUoZ2xvYmFsLmxvY2FsU3RvcmFnZSkpO1xuXG5hcmd2Lm9wdGlvbihbXG4gICAge1xuICAgICAgICBuYW1lOiAndXJsJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGhlIFVSTCB0byBiZSB1c2VkIHRvIGNvbm5lY3QgdG8gdGhlIE1hdHJpeCBIUycsXG4gICAgfSwge1xuICAgICAgICBuYW1lOiAndXNlcm5hbWUnLFxuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdUaGUgdXNlcm5hbWUgdG8gYmUgdXNlZCB0byBjb25uZWN0IHRvIHRoZSBNYXRyaXggSFMnLFxuICAgIH0sIHtcbiAgICAgICAgbmFtZTogJ3Bhc3N3b3JkJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGhlIHBhc3N3b3JkIHRvIGJlIHVzZWQgdG8gY29ubmVjdCB0byB0aGUgTWF0cml4IEhTJyxcbiAgICB9LCB7XG4gICAgICAgIG5hbWU6ICdwb3J0JyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnUG9ydCB0byBiaW5kIHRvIChkZWZhdWx0IDgwMDApJyxcbiAgICB9XG5dKTtcblxuY2xhc3MgQmxldmVIdHRwIHtcbiAgICByZXF1ZXN0OiBSZXF1ZXN0QVBJPFJlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnMsIFJlcXVpcmVkVXJpVXJsPjtcblxuICAgIGNvbnN0cnVjdG9yKGJhc2VVcmw6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlcXVlc3QgPSByZXF1ZXN0LmRlZmF1bHRzKHtcbiAgICAgICAgICAgIGJhc2VVcmwsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNlYXJjaChyZXE6IEJsZXZlUmVxdWVzdCl7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAncXVlcnknLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogcmVxLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpbmRleChldmVudHM6IEV2ZW50W10pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdpbmRleCcsXG4gICAgICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICAgICAganNvbjogdHJ1ZSxcbiAgICAgICAgICAgIGJvZHk6IGV2ZW50cyxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5jb25zdCBiID0gbmV3IEJsZXZlSHR0cChcImh0dHA6Ly9sb2NhbGhvc3Q6OTk5OS9hcGkvXCIpO1xuXG5jb25zdCBxID0gbmV3IFF1ZXVlKGFzeW5jIChiYXRjaDogRXZlbnRbXSwgY2IpID0+IHtcbiAgICB0cnkge1xuICAgICAgICBjYihudWxsLCBhd2FpdCBiLmluZGV4KGJhdGNoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYihlKTtcbiAgICB9XG59LCB7XG4gICAgYmF0Y2hTaXplOiAxMDAsXG4gICAgbWF4UmV0cmllczogMTAsXG4gICAgcmV0cnlEZWxheTogMTAwMCxcbiAgICBzdG9yZTogbmV3IFNxbGl0ZVN0b3JlKHtcbiAgICAgICAgcGF0aDogJy4vc3RvcmUvcXVldWUuc3FsaXRlJyxcbiAgICB9KSxcbiAgICBmaWx0ZXI6IChldmVudDogRXZlbnQsIGNiKSA9PiB7XG4gICAgICAgIGlmIChldmVudC50eXBlICE9PSAnbS5yb29tLm1lc3NhZ2UnKSByZXR1cm4gY2IoJ25vdCBtLnJvb20ubWVzc2FnZScpO1xuICAgICAgICByZXR1cm4gY2IobnVsbCwgZXZlbnQpO1xuICAgIH1cbn0pO1xuXG5xLm9uKCd0YXNrX2FjY2VwdGVkJywgZnVuY3Rpb24odGFza0lkOiBzdHJpbmcsIGV2OiBFdmVudCkge1xuICAgIGNvbnNvbGUuaW5mbyhgRW5xdWV1ZSBldmVudCAke2V2LnJvb21faWR9LyR7ZXYuZXZlbnRfaWR9ICR7ZXYuc2VuZGVyfSBbJHtldi50eXBlfV0gKCR7dGFza0lkfSlgKTtcbn0pO1xuXG5xLm9uKCdiYXRjaF9mYWlsZWQnLCBmdW5jdGlvbihlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW0VSUk9SXSBCYXRjaCBmYWlsZWQ6IFwiLCBlcnIpO1xufSk7XG5cbnNldHVwKCkudGhlbihjb25zb2xlLmxvZykuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbmludGVyZmFjZSBHcm91cFZhbHVlSlNPTiB7XG4gICAgb3JkZXI6IG51bWJlcjtcbiAgICBuZXh0X2JhdGNoPzogc3RyaW5nO1xuICAgIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG59XG5cbmNsYXNzIEdyb3VwVmFsdWUge1xuICAgIHB1YmxpYyBvcmRlcjogbnVtYmVyO1xuICAgIHB1YmxpYyBuZXh0X2JhdGNoOiBzdHJpbmc7XG4gICAgcHVibGljIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG5cbiAgICBjb25zdHJ1Y3RvcihvcmRlcjogbnVtYmVyKSB7XG4gICAgICAgIHRoaXMub3JkZXIgPSBvcmRlcjtcbiAgICAgICAgdGhpcy5uZXh0X2JhdGNoID0gXCJcIjtcbiAgICAgICAgdGhpcy5yZXN1bHRzID0gW107XG4gICAgfVxuXG4gICAgYWRkKGV2ZW50SWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlc3VsdHMucHVzaChldmVudElkKTtcbiAgICB9XG5cbiAgICAvLyBkb24ndCBzZW5kIG5leHRfYmF0Y2ggaWYgaXQgaXMgZW1wdHlcbiAgICB0b0pTT04oKTogR3JvdXBWYWx1ZUpTT04ge1xuICAgICAgICBjb25zdCBvOiBHcm91cFZhbHVlSlNPTiA9IHtcbiAgICAgICAgICAgIG9yZGVyOiB0aGlzLm9yZGVyLFxuICAgICAgICAgICAgcmVzdWx0czogdGhpcy5yZXN1bHRzLFxuICAgICAgICB9O1xuICAgICAgICBpZiAodGhpcy5uZXh0X2JhdGNoKSBvLm5leHRfYmF0Y2ggPSB0aGlzLm5leHRfYmF0Y2g7XG4gICAgICAgIHJldHVybiBvO1xuICAgIH1cbn1cblxuY2xhc3MgQmF0Y2gge1xuICAgIHB1YmxpYyBUb2tlbjogbnVtYmVyO1xuICAgIHB1YmxpYyBHcm91cDogc3RyaW5nO1xuICAgIHB1YmxpYyBHcm91cEtleTogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3IoVG9rZW46IG51bWJlciA9IDAsIEdyb3VwOiBzdHJpbmcsIEdyb3VwS2V5OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5Ub2tlbiA9IFRva2VuO1xuICAgICAgICB0aGlzLkdyb3VwID0gR3JvdXA7XG4gICAgICAgIHRoaXMuR3JvdXBLZXkgPSBHcm91cEtleTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZnJvbVN0cmluZyhmcm9tOiBzdHJpbmcpOiBCYXRjaCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvID0gSlNPTi5wYXJzZShmcm9tKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IGIgPSBuZXcgQmF0Y2gobyk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmcm9tKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5Ub2tlbjtcbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIFRva2VuOiB0aGlzLlRva2VuLFxuICAgICAgICAgICAgR3JvdXA6IHRoaXMuR3JvdXAsXG4gICAgICAgICAgICBHcm91cEtleTogdGhpcy5Hcm91cEtleSxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgUXVlcnkge1xuICAgIG11c3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gICAgc2hvdWxkPzogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICAgIG11c3ROb3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlcXVlc3Qge1xuICAgIGtleXM6IEFycmF5PHN0cmluZz47XG4gICAgZmlsdGVyOiBRdWVyeTtcbiAgICBzb3J0Qnk6IFNlYXJjaE9yZGVyO1xuICAgIHNlYXJjaFRlcm06IHN0cmluZztcbiAgICBmcm9tOiBudW1iZXI7XG4gICAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBwYWdlU2l6ZSA9IDEwO1xuXG5pbnRlcmZhY2UgQmxldmVSZXNwb25zZVJvdyB7XG4gICAgcm9vbUlkOiBzdHJpbmc7XG4gICAgZXZlbnRJZDogc3RyaW5nO1xuICAgIHNjb3JlOiBudW1iZXI7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlIHtcbiAgICByb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PjtcbiAgICB0b3RhbDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXZlbnRMb29rdXBSZXN1bHQge1xuICAgIGV2ZW50OiBNYXRyaXhFdmVudDtcbiAgICBzY29yZTogbnVtYmVyO1xuICAgIHN0YXRlPzogQXJyYXk8TWF0cml4RXZlbnQ+O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBSZXN1bHQge1xuICAgIHJhbms6IG51bWJlcjtcbiAgICByZXN1bHQ6IEV2ZW50O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG59XG5cbmNsYXNzIFNlYXJjaCB7XG4gICAgY2xpOiBNYXRyaXhDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcihjbGk6IE1hdHJpeENsaWVudCkge1xuICAgICAgICB0aGlzLmNsaSA9IGNsaTtcbiAgICB9XG5cbiAgICAvLyBpbXBlZGFuY2UgbWF0Y2hpbmcuXG4gICAgYXN5bmMgcmVzb2x2ZU9uZShyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nLCBjb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dCk6IFByb21pc2U8W0V2ZW50LCBFdmVudENvbnRleHR8dW5kZWZpbmVkXT4ge1xuICAgICAgICBpZiAoY29udGV4dCkge1xuICAgICAgICAgICAgY29uc3QgbGltaXQgPSBNYXRoLm1heChjb250ZXh0LmFmdGVyX2xpbWl0IHx8IDAsIGNvbnRleHQuYmVmb3JlX2xpbWl0IHx8IDAsIDMpO1xuICAgICAgICAgICAgY29uc3QgZXZjID0gYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudENvbnRleHQocm9vbUlkLCBldmVudElkLCBsaW1pdCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHtzdGFydCwgZW5kLCBldmVudHNfYmVmb3JlLCBldmVudHNfYWZ0ZXIsIHN0YXRlfSA9IGV2Yy5jb250ZXh0O1xuICAgICAgICAgICAgY29uc3QgY3R4OiBFdmVudENvbnRleHQgPSB7XG4gICAgICAgICAgICAgICAgc3RhcnQsXG4gICAgICAgICAgICAgICAgZW5kLFxuICAgICAgICAgICAgICAgIHByb2ZpbGVfaW5mbzogbmV3IE1hcDxzdHJpbmcsIFVzZXJQcm9maWxlPigpLFxuICAgICAgICAgICAgICAgIGV2ZW50c19iZWZvcmU6IGV2ZW50c19iZWZvcmUubWFwKChldjogTWF0cml4RXZlbnQpID0+IGV2LmV2ZW50KSxcbiAgICAgICAgICAgICAgICBldmVudHNfYWZ0ZXI6IGV2ZW50c19hZnRlci5tYXAoKGV2OiBNYXRyaXhFdmVudCkgPT4gZXYuZXZlbnQpLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgdXNlcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIFsuLi5ldmVudHNfYmVmb3JlLCBldmMuZXZlbnQsIC4uLmV2ZW50c19hZnRlcl0uZm9yRWFjaCgoZXY6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgdXNlcnMuYWRkKGV2LmdldFNlbmRlcigpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBzdGF0ZS5mb3JFYWNoKChldjogRXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXYudHlwZSA9PT0gJ20ucm9vbS5tZW1iZXInICYmIHVzZXJzLmhhcyhldi5zdGF0ZV9rZXkpKVxuICAgICAgICAgICAgICAgICAgICBjdHgucHJvZmlsZV9pbmZvLnNldChldi5zdGF0ZV9rZXksIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3BsYXluYW1lOiBldi5jb250ZW50WydkaXNwbGF5bmFtZSddLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXZhdGFyX3VybDogZXYuY29udGVudFsnYXZhdGFyX3VybCddLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gW2V2Yy5ldmVudCwgY3R4XTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudChyb29tSWQsIGV2ZW50SWQpLCB1bmRlZmluZWRdO1xuICAgIH1cblxuICAgIGFzeW5jIHJlc29sdmUocm93czogQXJyYXk8QmxldmVSZXNwb25zZVJvdz4sIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxBcnJheTxFdmVudExvb2t1cFJlc3VsdD4+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+ID0gW107XG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGw8dm9pZD4ocm93cy5tYXAoYXN5bmMgKHJvdzogQmxldmVSZXNwb25zZVJvdyk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbZXYsIGN0eF0gPSBhd2FpdCB0aGlzLnJlc29sdmVPbmUocm93LnJvb21JZCwgcm93LmV2ZW50SWQsIGNvbnRleHQpO1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGV2ZW50OiBldixcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dDogY3R4LFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogcm93LnNjb3JlLFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiByb3cuaGlnaGxpZ2h0cyxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgIH0pKTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcGFyYW0ga2V5cyB7c3RyaW5nfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc2VhcmNoRmlsdGVyIHtGaWx0ZXJ9IGNvbXB1dGUgYW5kIHNlbmQgcXVlcnkgcnVsZXMgdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc29ydEJ5IHtTZWFyY2hPcmRlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIHNlYXJjaFRlcm0ge3N0cmluZ30gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGZyb20ge251bWJlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGNvbnRleHQ/IHtSZXF1ZXN0RXZlbnRDb250ZXh0fSBpZiBkZWZpbmVkIHVzZSB0byBmZXRjaCBjb250ZXh0IGFmdGVyIGdvLWJsZXZlIGNhbGxcbiAgICAgKi9cbiAgICBhc3luYyBxdWVyeShrZXlzOiBBcnJheTxzdHJpbmc+LCBzZWFyY2hGaWx0ZXI6IEZpbHRlciwgc29ydEJ5OiBTZWFyY2hPcmRlciwgc2VhcmNoVGVybTogc3RyaW5nLCBmcm9tOiBudW1iZXIsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+LCBudW1iZXJdPiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcjogUXVlcnkgPSB7fTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIGZpZWxkcyB3ZSB3aWxsIHVzZSAod2UgZG9uJ3QgdXNlIHNob3VsZCBjdXJyZW50bHkpXG4gICAgICAgIGZpbHRlci5tdXN0ID0gbmV3IE1hcCgpO1xuICAgICAgICBmaWx0ZXIubXVzdE5vdCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgcm9vbV9pZFxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdyb29tX2lkJywgc2VhcmNoRmlsdGVyLnJvb21zKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RSb29tcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0Tm90LnNldCgncm9vbV9pZCcsIHNlYXJjaEZpbHRlci5ub3RSb29tcyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHNlbmRlclxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3NlbmRlcicsIHNlYXJjaEZpbHRlci5zZW5kZXJzKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdzZW5kZXInLCBzZWFyY2hGaWx0ZXIubm90U2VuZGVycyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHR5cGVcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci50eXBlcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0LnNldCgndHlwZScsIHNlYXJjaEZpbHRlci50eXBlcyk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90VHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3R5cGUnLCBzZWFyY2hGaWx0ZXIubm90VHlwZXMpO1xuXG4gICAgICAgIGNvbnN0IHI6IEJsZXZlUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGZyb20sXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgZmlsdGVyLFxuICAgICAgICAgICAgc29ydEJ5LFxuICAgICAgICAgICAgc2VhcmNoVGVybSxcbiAgICAgICAgICAgIHNpemU6IHBhZ2VTaXplLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3A6IEJsZXZlUmVzcG9uc2UgPSBhd2FpdCBiLnNlYXJjaChyKTtcbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLnJlc29sdmUocmVzcC5yb3dzLCBjb250ZXh0KSwgcmVzcC50b3RhbF07XG4gICAgfVxufVxuXG5lbnVtIFNlYXJjaE9yZGVyIHtcbiAgICBSYW5rID0gJ3JhbmsnLFxuICAgIFJlY2VudCA9ICdyZWNlbnQnLFxufVxuXG5hc3luYyBmdW5jdGlvbiBzZXR1cCgpIHtcbiAgICBjb25zdCBhcmdzID0gYXJndi5ydW4oKTtcblxuICAgIGNvbnN0IGJhc2VVcmwgPSBhcmdzLm9wdGlvbnNbJ3VybCddIHx8ICdodHRwczovL21hdHJpeC5vcmcnO1xuXG4gICAgbGV0IGNyZWRzID0ge1xuICAgICAgICB1c2VySWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgndXNlcklkJyksXG4gICAgICAgIGRldmljZUlkOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2RldmljZUlkJyksXG4gICAgICAgIGFjY2Vzc1Rva2VuOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2FjY2Vzc1Rva2VuJyksXG4gICAgfTtcblxuICAgIGlmICghY3JlZHMudXNlcklkIHx8ICFjcmVkcy5kZXZpY2VJZCB8fCAhY3JlZHMuYWNjZXNzVG9rZW4pIHtcbiAgICAgICAgaWYgKCFhcmdzLm9wdGlvbnNbJ3VzZXJuYW1lJ10gfHwgIWFyZ3Mub3B0aW9uc1sncGFzc3dvcmQnXSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ1VzZXJuYW1lIGFuZCBQYXNzd29yZCB3ZXJlIG5vdCBzcGVjaWZpZWQgb24gdGhlIGNvbW1hbmRsaW5lIGFuZCBub25lIHdlcmUgc2F2ZWQnKTtcbiAgICAgICAgICAgIGFyZ3YuaGVscCgpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KC0xKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvZ2luQ2xpZW50ID0gY3JlYXRlQ2xpZW50KHtiYXNlVXJsfSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGxvZ2luQ2xpZW50LmxvZ2luKCdtLmxvZ2luLnBhc3N3b3JkJywge1xuICAgICAgICAgICAgICAgIHVzZXI6IGFyZ3Mub3B0aW9uc1sndXNlcm5hbWUnXSxcbiAgICAgICAgICAgICAgICBwYXNzd29yZDogYXJncy5vcHRpb25zWydwYXNzd29yZCddLFxuICAgICAgICAgICAgICAgIGluaXRpYWxfZGV2aWNlX2Rpc3BsYXlfbmFtZTogJ01hdHJpeCBTZWFyY2ggRGFlbW9uJyxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTG9nZ2VkIGluIGFzICcgKyByZXMudXNlcl9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ3VzZXJJZCcsIHJlcy51c2VyX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnZGV2aWNlSWQnLCByZXMuZGV2aWNlX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnYWNjZXNzVG9rZW4nLCByZXMuYWNjZXNzX3Rva2VuKTtcblxuICAgICAgICAgICAgY3JlZHMgPSB7XG4gICAgICAgICAgICAgICAgdXNlcklkOiByZXMudXNlcl9pZCxcbiAgICAgICAgICAgICAgICBkZXZpY2VJZDogcmVzLmRldmljZV9pZCxcbiAgICAgICAgICAgICAgICBhY2Nlc3NUb2tlbjogcmVzLmFjY2Vzc190b2tlbixcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0FuIGVycm9yIG9jY3VyZWQgbG9nZ2luZyBpbiEnKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGVycik7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGkgPSBjcmVhdGVDbGllbnQoe1xuICAgICAgICBiYXNlVXJsLFxuICAgICAgICBpZEJhc2VVcmw6ICcnLFxuICAgICAgICAuLi5jcmVkcyxcbiAgICAgICAgdXNlQXV0aG9yaXphdGlvbkhlYWRlcjogdHJ1ZSxcbiAgICAgICAgc3RvcmU6IG5ldyBNYXRyaXhJbk1lbW9yeVN0b3JlKHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZTogZ2xvYmFsLmxvY2FsU3RvcmFnZSxcbiAgICAgICAgfSksXG4gICAgICAgIHNlc3Npb25TdG9yZTogbmV3IFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUoZ2xvYmFsLmxvY2FsU3RvcmFnZSksXG4gICAgfSk7XG5cbiAgICBjbGkub24oJ2V2ZW50JywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuaXNFbmNyeXB0ZWQoKSkgcmV0dXJuO1xuICAgICAgICByZXR1cm4gcS5wdXNoKGV2ZW50LmdldENsZWFyRXZlbnQoKSk7XG4gICAgfSk7XG4gICAgY2xpLm9uKCdFdmVudC5kZWNyeXB0ZWQnLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5pc0RlY3J5cHRpb25GYWlsdXJlKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihldmVudC5ldmVudCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHEucHVzaChldmVudC5nZXRDbGVhckV2ZW50KCkpO1xuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY2xpLmluaXRDcnlwdG8oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH1cbiAgICBjbGkuc3RhcnRDbGllbnQoKTtcblxuICAgIGNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbiAgICBhcHAudXNlKGJvZHlQYXJzZXIuanNvbigpKTtcbiAgICBhcHAudXNlKGNvcnMoe1xuICAgICAgICAnYWxsb3dlZEhlYWRlcnMnOiBbJ2FjY2Vzc190b2tlbicsICdDb250ZW50LVR5cGUnXSxcbiAgICAgICAgJ2V4cG9zZWRIZWFkZXJzJzogWydhY2Nlc3NfdG9rZW4nXSxcbiAgICAgICAgJ29yaWdpbic6ICcqJyxcbiAgICAgICAgJ21ldGhvZHMnOiAnUE9TVCcsXG4gICAgICAgICdwcmVmbGlnaHRDb250aW51ZSc6IGZhbHNlXG4gICAgfSkpO1xuXG4gICAgYXBwLnBvc3QoJy9zZWFyY2gnLCBhc3luYyAocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKSA9PiB7XG4gICAgICAgIGlmICghcmVxLmJvZHkpIHtcbiAgICAgICAgICAgIHJlcy5zZW5kU3RhdHVzKDQwMCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgbmV4dEJhdGNoOiBCYXRjaCB8IG51bGwgPSBudWxsO1xuICAgICAgICBpZiAocmVxLnF1ZXJ5WyduZXh0X2JhdGNoJ10pIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbmV4dEJhdGNoID0gSlNPTi5wYXJzZShnbG9iYWwuYXRvYihyZXEucXVlcnlbJ25leHRfYmF0Y2gnXSkpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuaW5mbyhcIkZvdW5kIG5leHQgYmF0Y2ggb2ZcIiwgbmV4dEJhdGNoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHBhcnNlIG5leHRfYmF0Y2ggYXJndW1lbnRcIiwgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyB2ZXJpZnkgdGhhdCB1c2VyIGlzIGFsbG93ZWQgdG8gYWNjZXNzIHRoaXMgdGhpbmdcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNhc3RCb2R5OiBNYXRyaXhTZWFyY2hSZXF1ZXN0ID0gcmVxLmJvZHk7XG4gICAgICAgICAgICBjb25zdCByb29tQ2F0ID0gY2FzdEJvZHkuc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHM7XG5cbiAgICAgICAgICAgIGlmICghcm9vbUNhdCkge1xuICAgICAgICAgICAgICAgIHJlcy5zZW5kU3RhdHVzKDUwMSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQga2V5czogQXJyYXk8UmVxdWVzdEtleT4gPSBbUmVxdWVzdEtleS5ib2R5LCBSZXF1ZXN0S2V5Lm5hbWUsIFJlcXVlc3RLZXkudG9waWNdOyAvLyBkZWZhdWx0IHZhbHVlIGZvciByb29tQ2F0LmtleVxuICAgICAgICAgICAgaWYgKHJvb21DYXQua2V5cyAmJiByb29tQ2F0LmtleXMubGVuZ3RoKSBrZXlzID0gcm9vbUNhdC5rZXlzO1xuXG4gICAgICAgICAgICBjb25zdCBpbmNsdWRlU3RhdGUgPSBCb29sZWFuKHJvb21DYXRbJ2luY2x1ZGVfc3RhdGUnXSk7XG4gICAgICAgICAgICBjb25zdCBldmVudENvbnRleHQgPSByb29tQ2F0WydldmVudF9jb250ZXh0J107XG5cbiAgICAgICAgICAgIGxldCBncm91cEJ5Um9vbUlkID0gZmFsc2U7XG4gICAgICAgICAgICBsZXQgZ3JvdXBCeVNlbmRlciA9IGZhbHNlO1xuICAgICAgICAgICAgaWYgKHJvb21DYXQuZ3JvdXBpbmdzICYmIHJvb21DYXQuZ3JvdXBpbmdzLmdyb3VwX2J5KSB7XG4gICAgICAgICAgICAgICAgcm9vbUNhdC5ncm91cGluZ3MuZ3JvdXBfYnkuZm9yRWFjaChncm91cGluZyA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoZ3JvdXBpbmcua2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlIFJlcXVlc3RHcm91cEtleS5yb29tSWQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBCeVJvb21JZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlIFJlcXVlc3RHcm91cEtleS5zZW5kZXI6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBCeVNlbmRlciA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyID0gbmV3IEZpbHRlcihyb29tQ2F0LmZpbHRlciB8fCB7fSk7IC8vIGRlZmF1bHQgdG8gZW1wdHkgb2JqZWN0IHRvIGFzc3VtZSBkZWZhdWx0c1xuXG4gICAgICAgICAgICAvLyBUT0RPIHRoaXMgaXMgcmVtb3ZlZCBiZWNhdXNlIHJvb21zIHN0b3JlIGlzIHVucmVsaWFibGUgQUZcbiAgICAgICAgICAgIC8vIGNvbnN0IGpvaW5lZFJvb21zID0gY2xpLmdldFJvb21zKCk7XG4gICAgICAgICAgICAvLyBjb25zdCByb29tSWRzID0gam9pbmVkUm9vbXMubWFwKChyb29tOiBSb29tKSA9PiByb29tLnJvb21JZCk7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gaWYgKHJvb21JZHMubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgLy8gICAgIHJlcy5qc29uKHtcbiAgICAgICAgICAgIC8vICAgICAgICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIHJvb21fZXZlbnRzOiB7XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogW10sXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgICAgcmVzdWx0czogW10sXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgICAgY291bnQ6IDAsXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gICAgICAgICB9LFxuICAgICAgICAgICAgLy8gICAgIH0pO1xuICAgICAgICAgICAgLy8gICAgIHJldHVybjtcbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgLy8gU0tJUCBmb3Igbm93XG4gICAgICAgICAgICAvLyBsZXQgcm9vbUlkc1NldCA9IHNlYXJjaEZpbHRlci5maWx0ZXJSb29tcyhyb29tSWRzKTtcblxuICAgICAgICAgICAgLy8gaWYgKGIuaXNHcm91cGluZyhcInJvb21faWRcIikpIHtcbiAgICAgICAgICAgIC8vICAgICByb29tSURzU2V0LkludGVyc2VjdChjb21tb24uTmV3U3RyaW5nU2V0KFtdc3RyaW5neypiLkdyb3VwS2V5fSkpXG4gICAgICAgICAgICAvLyB9XG5cbiAgICAgICAgICAgIC8vIFRPRE8gZG8gd2UgbmVlZCB0aGlzXG4gICAgICAgICAgICAvL3JhbmtNYXAgOj0gbWFwW3N0cmluZ11mbG9hdDY0e31cbiAgICAgICAgICAgIC8vYWxsb3dlZEV2ZW50cyA6PSBbXSpSZXN1bHR7fVxuICAgICAgICAgICAgLy8gVE9ETyB0aGVzZSBuZWVkIGNoYW5naW5nXG4gICAgICAgICAgICBjb25zdCByb29tR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+KCk7XG4gICAgICAgICAgICBjb25zdCBzZW5kZXJHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4oKTtcblxuICAgICAgICAgICAgbGV0IGdsb2JhbE5leHRCYXRjaDogc3RyaW5nfHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgY29uc3Qgcm9vbXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoID0gbmV3IFNlYXJjaChjbGkpO1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoVGVybSA9IHJvb21DYXRbJ3NlYXJjaF90ZXJtJ107XG5cbiAgICAgICAgICAgIGxldCBhbGxvd2VkRXZlbnRzOiBBcnJheTxFdmVudExvb2t1cFJlc3VsdD47XG4gICAgICAgICAgICBsZXQgY291bnQ6IG51bWJlciA9IDA7XG5cbiAgICAgICAgICAgIC8vIFRPRE8gZXh0ZW5kIGxvY2FsIGV2ZW50IG1hcCB1c2luZyBzcWxpdGUvbGV2ZWxkYlxuICAgICAgICAgICAgc3dpdGNoIChyb29tQ2F0WydvcmRlcl9ieSddKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAncmFuayc6XG4gICAgICAgICAgICAgICAgY2FzZSAnJzpcbiAgICAgICAgICAgICAgICAgICAgLy8gZ2V0IG1lc3NhZ2VzIGZyb20gQmxldmUgYnkgcmFuayAvLyByZXNvbHZlIHRoZW0gbG9jYWxseVxuICAgICAgICAgICAgICAgICAgICBbYWxsb3dlZEV2ZW50cywgY291bnRdID0gYXdhaXQgc2VhcmNoLnF1ZXJ5KGtleXMsIHNlYXJjaEZpbHRlciwgU2VhcmNoT3JkZXIuUmFuaywgc2VhcmNoVGVybSwgMCwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdyZWNlbnQnOlxuICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tID0gbmV4dEJhdGNoICE9PSBudWxsID8gbmV4dEJhdGNoLmZyb20oKSA6IDA7XG4gICAgICAgICAgICAgICAgICAgIFthbGxvd2VkRXZlbnRzLCBjb3VudF0gPSBhd2FpdCBzZWFyY2gucXVlcnkoa2V5cywgc2VhcmNoRmlsdGVyLCBTZWFyY2hPcmRlci5SZWNlbnQsIHNlYXJjaFRlcm0sIGZyb20sIGV2ZW50Q29udGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRPRE8gZ2V0IG5leHQgYmFjayBoZXJlXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAxKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoYWxsb3dlZEV2ZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBoaWdobGlnaHRzU3VwZXJzZXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdHM6IEFycmF5PFJlc3VsdD4gPSBbXTtcblxuICAgICAgICAgICAgYWxsb3dlZEV2ZW50cy5mb3JFYWNoKChyb3c6IEV2ZW50TG9va3VwUmVzdWx0KSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gY2FsY3VsYXRlIGhpZ2h0bGlnaHRzU3VwZXJzZXRcbiAgICAgICAgICAgICAgICByb3cuaGlnaGxpZ2h0cy5mb3JFYWNoKChoaWdobGlnaHQ6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzU3VwZXJzZXQuYWRkKGhpZ2hsaWdodCk7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB7ZXZlbnQ6IGV2fSA9IHJvdztcblxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gcm9vbUdyb3Vwcy5nZXQoZXYuZ2V0Um9vbUlkKCkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXYpIHYgPSBuZXcgR3JvdXBWYWx1ZShyb3cuc2NvcmUpO1xuICAgICAgICAgICAgICAgICAgICB2LmFkZChldi5nZXRJZCgpKTtcbiAgICAgICAgICAgICAgICAgICAgcm9vbUdyb3Vwcy5zZXQoZXYuZ2V0Um9vbUlkKCksIHYpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVNlbmRlcikge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdiA9IHNlbmRlckdyb3Vwcy5nZXQoZXYuZ2V0U2VuZGVyKCkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXYpIHYgPSBuZXcgR3JvdXBWYWx1ZShyb3cuc2NvcmUpO1xuICAgICAgICAgICAgICAgICAgICB2LmFkZChldi5nZXRJZCgpKTtcbiAgICAgICAgICAgICAgICAgICAgc2VuZGVyR3JvdXBzLnNldChldi5nZXRTZW5kZXIoKSwgdik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcm9vbXMuYWRkKGV2LmdldFJvb21JZCgpKTtcblxuICAgICAgICAgICAgICAgIC8vIGFkZCB0byByZXN1bHRzIGFycmF5XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoIDwgc2VhcmNoRmlsdGVyLmxpbWl0KVxuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmFuazogcm93LnNjb3JlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiByb3cuZXZlbnQuZXZlbnQsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0OiByb3cuY29udGV4dCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCByb29tU3RhdGVNYXAgPSBuZXcgTWFwPHN0cmluZywgQXJyYXk8TWF0cml4RXZlbnQ+PigpO1xuICAgICAgICAgICAgaWYgKGluY2x1ZGVTdGF0ZSkge1xuICAgICAgICAgICAgICAgIC8vIFRPRE8gZmV0Y2ggc3RhdGUgZnJvbSBzZXJ2ZXIgdXNpbmcgQVBJIGJlY2F1c2UganMtc2RrIGlzIGJyb2tlbiBkdWUgdG8gc3RvcmVcbiAgICAgICAgICAgICAgICByb29tcy5mb3JFYWNoKChyb29tSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByb29tID0gY2xpLmdldFJvb20ocm9vbUlkKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJvb20pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvb21TdGF0ZU1hcC5zZXQocm9vbUlkLCByb29tLmN1cnJlbnRTdGF0ZS5yZWR1Y2UoKGFjYywgbWFwOiBNYXA8c3RyaW5nLCBNYXRyaXhFdmVudD4pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZm9yRWFjaCgoZXY6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjYy5wdXNoKGV2KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSwgW10pKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXNwOiBNYXRyaXhTZWFyY2hSZXNwb25zZSA9IHtcbiAgICAgICAgICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8gc3BsaXQgdG8gbWFrZSBUeXBlU2NyaXB0IGhhcHB5IHdpdGggdGhlIGlmIHN0YXRlbWVudHMgZm9sbG93aW5nXG4gICAgICAgICAgICByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzID0ge1xuICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IGhpZ2hsaWdodHNTdXBlcnNldCxcbiAgICAgICAgICAgICAgICByZXN1bHRzLFxuICAgICAgICAgICAgICAgIGNvdW50LFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gb21pdGVtcHR5IGJlaGF2aW91ciB1c2luZyBpZiB0byBhdHRhY2ggb250byBvYmplY3QgdG8gYmUgc2VyaWFsaXplZFxuICAgICAgICAgICAgaWYgKGdsb2JhbE5leHRCYXRjaCkgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5uZXh0X2JhdGNoID0gZ2xvYmFsTmV4dEJhdGNoO1xuICAgICAgICAgICAgaWYgKGluY2x1ZGVTdGF0ZSkgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5zdGF0ZSA9IHJvb21TdGF0ZU1hcDtcblxuICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQgfHwgZ3JvdXBCeVNlbmRlcikge1xuICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+PigpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplR3JvdXBWYWx1ZU9yZGVyKHJvb21Hcm91cHMudmFsdWVzKCkpO1xuICAgICAgICAgICAgICAgICAgICByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLmdyb3Vwcy5zZXQoUmVxdWVzdEdyb3VwS2V5LnJvb21JZCwgcm9vbUdyb3Vwcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZUdyb3VwVmFsdWVPcmRlcihzZW5kZXJHcm91cHMudmFsdWVzKCkpO1xuICAgICAgICAgICAgICAgICAgICByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLmdyb3Vwcy5zZXQoUmVxdWVzdEdyb3VwS2V5LnNlbmRlciwgc2VuZGVyR3JvdXBzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgcmVzLnN0YXR1cygyMDApO1xuICAgICAgICAgICAgcmVzLmpzb24ocmVzcCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ2F0YXN0cm9waGVcIiwgZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgcG9ydCA9IGFyZ3Mub3B0aW9uc1sncG9ydCddIHx8IDgwMDA7XG4gICAgYXBwLmxpc3Rlbihwb3J0LCAoKSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBXZSBhcmUgbGl2ZSBvbiAke3BvcnR9YCk7XG4gICAgfSk7XG59XG5cbi8vIFRPRE8gcGFnaW5hdGlvblxuLy8gVE9ETyBncm91cHMtcGFnaW5hdGlvblxuLy8gVE9ETyBiYWNrZmlsbFxuXG5mdW5jdGlvbiBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIoaXQ6IEl0ZXJhYmxlSXRlcmF0b3I8R3JvdXBWYWx1ZT4pIHtcbiAgICBsZXQgaSA9IDE7XG4gICAgQXJyYXkuZnJvbShpdCkuc29ydCgoYTogR3JvdXBWYWx1ZSwgYjogR3JvdXBWYWx1ZSkgPT4gYS5vcmRlci1iLm9yZGVyKS5mb3JFYWNoKChnOiBHcm91cFZhbHVlKSA9PiB7XG4gICAgICAgIC8vIG5vcm1hbGl6ZSBvcmRlciBiYXNlZCBvbiBzb3J0IGJ5IGZsb2F0XG4gICAgICAgIGcub3JkZXIgPSBpKys7XG4gICAgfSk7XG59XG5cbmNsYXNzIEZpbHRlciB7XG4gICAgcm9vbXM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFJvb21zOiBTZXQ8c3RyaW5nPjtcbiAgICBzZW5kZXJzOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RTZW5kZXJzOiBTZXQ8c3RyaW5nPjtcbiAgICB0eXBlczogU2V0PHN0cmluZz47XG4gICAgbm90VHlwZXM6IFNldDxzdHJpbmc+O1xuICAgIGxpbWl0OiBudW1iZXI7XG4gICAgY29udGFpbnNVUkw6IGJvb2xlYW4gfCB1bmRlZmluZWQ7XG5cbiAgICBjb25zdHJ1Y3RvcihvOiBvYmplY3QpIHtcbiAgICAgICAgdGhpcy5yb29tcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydyb29tcyddKTtcbiAgICAgICAgdGhpcy5ub3RSb29tcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3Rfcm9vbXMnXSk7XG4gICAgICAgIHRoaXMuc2VuZGVycyA9IG5ldyBTZXQ8c3RyaW5nPihvWydzZW5kZXJzJ10pO1xuICAgICAgICB0aGlzLm5vdFNlbmRlcnMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3NlbmRlcnMnXSk7XG4gICAgICAgIHRoaXMudHlwZXMgPSBuZXcgU2V0PHN0cmluZz4ob1sndHlwZXMnXSk7XG4gICAgICAgIHRoaXMubm90VHlwZXMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3R5cGVzJ10pO1xuXG4gICAgICAgIHRoaXMubGltaXQgPSB0eXBlb2Ygb1snbGltaXQnXSA9PT0gXCJudW1iZXJcIiA/IG9bJ2xpbWl0J10gOiAxMDtcbiAgICAgICAgdGhpcy5jb250YWluc1VSTCA9IG9bJ2NvbnRhaW5zX3VybCddO1xuICAgIH1cbn1cblxuaW50ZXJmYWNlIFJlcXVlc3RFdmVudENvbnRleHQge1xuICAgIGJlZm9yZV9saW1pdD86IG51bWJlcjtcbiAgICBhZnRlcl9saW1pdD86IG51bWJlcjtcbiAgICBpbmNsdWRlX3Byb2ZpbGU6IGJvb2xlYW47XG59XG5cbmVudW0gUmVxdWVzdEdyb3VwS2V5IHtcbiAgICByb29tSWQgPSBcInJvb21faWRcIixcbiAgICBzZW5kZXIgPSBcInNlbmRlclwiLFxufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEdyb3VwIHtcbiAgICBrZXk6IFJlcXVlc3RHcm91cEtleTtcbn1cblxuaW50ZXJmYWNlIFJlcXVlc3RHcm91cHMge1xuICAgIGdyb3VwX2J5PzogQXJyYXk8UmVxdWVzdEdyb3VwPjtcbn1cblxuZW51bSBSZXF1ZXN0S2V5IHtcbiAgICBib2R5ID0gXCJjb250ZW50LmJvZHlcIixcbiAgICBuYW1lID0gXCJjb250ZW50Lm5hbWVcIixcbiAgICB0b3BpYyA9IFwiY29udGVudC50b3BpY1wiLFxufVxuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVxdWVzdEJvZHkge1xuICAgIHNlYXJjaF90ZXJtOiBzdHJpbmc7XG4gICAga2V5cz86IEFycmF5PFJlcXVlc3RLZXk+O1xuICAgIGZpbHRlcj86IG9iamVjdDsgLy8gdGhpcyBnZXRzIGluZmxhdGVkIHRvIGFuIGluc3RhbmNlIG9mIEZpbHRlclxuICAgIG9yZGVyX2J5Pzogc3RyaW5nO1xuICAgIGV2ZW50X2NvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0O1xuICAgIGluY2x1ZGVTdGF0ZT86IGJvb2xlYW47XG4gICAgZ3JvdXBpbmdzPzogUmVxdWVzdEdyb3Vwcztcbn1cblxuaW50ZXJmYWNlIE1hdHJpeFNlYXJjaFJlcXVlc3Qge1xuICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgIHJvb21fZXZlbnRzPzogTWF0cml4U2VhcmNoUmVxdWVzdEJvZHk7XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVzcG9uc2Uge1xuICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgIHJvb21fZXZlbnRzPzoge1xuICAgICAgICAgICAgY291bnQ6IG51bWJlcjtcbiAgICAgICAgICAgIHJlc3VsdHM6IEFycmF5PFJlc3VsdD47XG4gICAgICAgICAgICBoaWdobGlnaHRzOiBTZXQ8c3RyaW5nPjtcbiAgICAgICAgICAgIHN0YXRlPzogTWFwPHN0cmluZywgQXJyYXk8RXZlbnQ+PjtcbiAgICAgICAgICAgIGdyb3Vwcz86IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+PjtcbiAgICAgICAgICAgIG5leHRfYmF0Y2g/OiBzdHJpbmc7XG4gICAgICAgIH1cbiAgICB9XG59Il19