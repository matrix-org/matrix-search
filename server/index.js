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
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const mkdirp = __importStar(require("mkdirp"));
// import sqlite3 from 'sqlite3';
// const indexeddbjs = require('indexeddb-js');
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
let indexedDB;
// const engine = new sqlite3.Database('./store/indexedb.sqlite');
// const scope = indexeddbjs.makeScope('sqlite3', engine);
// indexedDB = scope.indexedDB;
if (indexedDB) {
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(indexedDB, 'matrix-js-sdk:crypto'));
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(null));
}
else {
    matrix_js_sdk_1.setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));
}
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
    let creds = {
        userId: global.localStorage.getItem('userId'),
        deviceId: global.localStorage.getItem('deviceId'),
        accessToken: global.localStorage.getItem('accessToken'),
    };
    if (!creds.userId || !creds.deviceId || !creds.accessToken) {
        const loginClient = matrix_js_sdk_1.createClient({
            baseUrl: 'https://matrix.org',
        });
        try {
            const res = await loginClient.login('m.login.password', {
                user: '@webdevguru:matrix.org',
                password: 'tlD$@5ZCUW41Y#Hg',
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
    const cli = matrix_js_sdk_1.createClient(Object.assign({ baseUrl: 'https://matrix.org', idBaseUrl: '' }, creds, { useAuthorizationHeader: true, 
        // sessionStore: new LevelStore(),
        // store: new IndexedDBStore({
        //     indexedDB: indexedDB,
        //     dbName: 'matrix-search-sync',
        //     localStorage: global.localStorage,
        // }),
        store: new matrix_js_sdk_1.MatrixInMemoryStore({
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
    const port = 8000;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFVQSxnREFBd0I7QUFDeEIsc0RBQW1EO0FBQ25ELDhEQUFxQztBQUNyQywrQ0FBaUM7QUFHakMsaUNBQWlDO0FBRWpDLCtDQUErQztBQUMvQyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDdEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUM7QUFDbkQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFFM0MsTUFBTSx1QkFBdUIsR0FBRyxPQUFPLENBQUMsMERBQTBELENBQUMsQ0FBQyxPQUFPLENBQUM7QUFFNUcsZ0RBQWdEO0FBQ2hELE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdkIsOEJBQThCO0FBQzlCLElBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsWUFBWSxLQUFLLElBQUk7SUFDMUUsTUFBTSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUVsRywwREFBMEQ7QUFDMUQsTUFBTSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFNUIsaURBYXVCO0FBRXZCLDZDQUE2QztBQUM3QywrQkFBNkI7QUFDN0IsNkNBQTZDO0FBQzdDLHlCQUF1QjtBQUV2QixJQUFJLFNBQVMsQ0FBQztBQUVkLGtFQUFrRTtBQUNsRSwwREFBMEQ7QUFDMUQsK0JBQStCO0FBRS9CLElBQUksU0FBUyxFQUFFO0lBQ1gsNEZBQTRGO0lBQzVGLCtEQUErRDtDQUNsRTtLQUFNO0lBQ0gscUNBQXFCLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSx1QkFBdUIsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztDQUNqRjtBQUdEO0lBR0ksWUFBWSxPQUFlO1FBQ3ZCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztZQUM1QixPQUFPO1NBQ1YsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELE1BQU0sQ0FBQyxHQUFpQjtRQUNwQixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUM7WUFDaEIsR0FBRyxFQUFFLE9BQU87WUFDWixNQUFNLEVBQUUsTUFBTTtZQUNkLElBQUksRUFBRSxJQUFJO1lBQ1YsSUFBSSxFQUFFLEdBQUc7U0FDWixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQWU7UUFDakIsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO1lBQ2hCLEdBQUcsRUFBRSxPQUFPO1lBQ1osTUFBTSxFQUFFLEtBQUs7WUFDYixJQUFJLEVBQUUsSUFBSTtZQUNWLElBQUksRUFBRSxNQUFNO1NBQ2YsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBRUQsTUFBTSxDQUFDLEdBQUcsSUFBSSxTQUFTLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUV0RCxNQUFNLENBQUMsR0FBRyxJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBYyxFQUFFLEVBQUUsRUFBRSxFQUFFO0lBQzdDLElBQUk7UUFDQSxFQUFFLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0tBQ2xDO0lBQUMsT0FBTyxDQUFDLEVBQUU7UUFDUixFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7S0FDVDtBQUNMLENBQUMsRUFBRTtJQUNDLFNBQVMsRUFBRSxHQUFHO0lBQ2QsVUFBVSxFQUFFLEVBQUU7SUFDZCxVQUFVLEVBQUUsSUFBSTtJQUNoQixLQUFLLEVBQUUsSUFBSSxXQUFXLENBQUM7UUFDbkIsSUFBSSxFQUFFLHNCQUFzQjtLQUMvQixDQUFDO0lBQ0YsTUFBTSxFQUFFLENBQUMsS0FBWSxFQUFFLEVBQUUsRUFBRSxFQUFFO1FBQ3pCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxnQkFBZ0I7WUFBRSxPQUFPLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3JFLE9BQU8sRUFBRSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztJQUMzQixDQUFDO0NBQ0osQ0FBQyxDQUFDO0FBRUgsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxlQUFlLEVBQUUsVUFBUyxNQUFjLEVBQUUsRUFBUztJQUNwRCxPQUFPLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLE1BQU0sS0FBSyxFQUFFLENBQUMsSUFBSSxNQUFNLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDckcsQ0FBQyxDQUFDLENBQUM7QUFFSCxDQUFDLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxVQUFTLEdBQUc7SUFDN0IsT0FBTyxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUNqRCxDQUFDLENBQUMsQ0FBQztBQUVILEtBQUssRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQVEvQztJQUtJLFlBQVksS0FBYTtRQUNyQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNuQixJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUUsQ0FBQztRQUNyQixJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztJQUN0QixDQUFDO0lBRUQsR0FBRyxDQUFDLE9BQWU7UUFDZixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUMvQixDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLE1BQU07UUFDRixNQUFNLENBQUMsR0FBbUI7WUFDdEIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2pCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztTQUN4QixDQUFDO1FBQ0YsSUFBSSxJQUFJLENBQUMsVUFBVTtZQUFFLENBQUMsQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQztRQUNwRCxPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7Q0FDSjtBQUVEO0lBS0ksWUFBWSxRQUFnQixDQUFDLEVBQUUsS0FBYSxFQUFFLFFBQWdCO1FBQzFELElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzdCLENBQUM7SUFFRCxNQUFNLENBQUMsVUFBVSxDQUFDLElBQVk7UUFDMUIsSUFBSTtZQUNBLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDM0IsMEJBQTBCO1NBQzdCO1FBQUMsT0FBTyxDQUFDLEVBQUU7WUFDUixPQUFPLFNBQVMsQ0FBQztTQUNwQjtJQUNMLENBQUM7SUFFRCxJQUFJO1FBQ0EsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ3RCLENBQUM7SUFFRCxRQUFRO1FBQ0osT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2xCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1NBQzFCLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQWlCRCxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUM7QUE0QnBCO0lBR0ksWUFBWSxHQUFpQjtRQUN6QixJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztJQUNuQixDQUFDO0lBRUQsc0JBQXNCO0lBQ3RCLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBYyxFQUFFLE9BQWUsRUFBRSxPQUE2QjtRQUMzRSxJQUFJLE9BQU8sRUFBRTtZQUNULE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFdBQVcsSUFBSSxDQUFDLEVBQUUsT0FBTyxDQUFDLFlBQVksSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDL0UsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFFckUsTUFBTSxFQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUMsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQ3JFLE1BQU0sR0FBRyxHQUFpQjtnQkFDdEIsS0FBSztnQkFDTCxHQUFHO2dCQUNILFlBQVksRUFBRSxJQUFJLEdBQUcsRUFBdUI7Z0JBQzVDLGFBQWEsRUFBRSxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBZSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDO2dCQUMvRCxZQUFZLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQWUsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQzthQUNoRSxDQUFDO1lBRUYsTUFBTSxLQUFLLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztZQUNoQyxDQUFDLEdBQUcsYUFBYSxFQUFFLEdBQUcsQ0FBQyxLQUFLLEVBQUUsR0FBRyxZQUFZLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFlLEVBQUUsRUFBRTtnQkFDdkUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUM5QixDQUFDLENBQUMsQ0FBQztZQUVILEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFTLEVBQUUsRUFBRTtnQkFDeEIsSUFBSSxFQUFFLENBQUMsSUFBSSxLQUFLLGVBQWUsSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUM7b0JBQ3RELEdBQUcsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUU7d0JBQy9CLFdBQVcsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQzt3QkFDdEMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDO3FCQUN2QyxDQUFDLENBQUM7WUFDWCxDQUFDLENBQUMsQ0FBQztZQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1NBQzNCO1FBRUQsT0FBTyxDQUFDLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLElBQTZCLEVBQUUsT0FBNkI7UUFDdEUsTUFBTSxPQUFPLEdBQTZCLEVBQUUsQ0FBQztRQUU3QyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsR0FBcUIsRUFBaUIsRUFBRTtZQUM1RSxJQUFJO2dCQUNBLE1BQU0sQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztnQkFDMUUsT0FBTyxDQUFDLElBQUksQ0FBQztvQkFDVCxLQUFLLEVBQUUsRUFBRTtvQkFDVCxPQUFPLEVBQUUsR0FBRztvQkFDWixLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7b0JBQ2hCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVTtpQkFDN0IsQ0FBQyxDQUFDO2FBQ047WUFBQyxPQUFPLENBQUMsRUFBRSxHQUFFO1FBQ2xCLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFSixPQUFPLE9BQU8sQ0FBQztJQUNuQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBbUIsRUFBRSxZQUFvQixFQUFFLE1BQW1CLEVBQUUsVUFBa0IsRUFBRSxJQUFZLEVBQUUsT0FBNkI7UUFDdkksTUFBTSxNQUFNLEdBQVUsRUFBRSxDQUFDO1FBRXpCLGdFQUFnRTtRQUNoRSxNQUFNLENBQUMsSUFBSSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7UUFDeEIsTUFBTSxDQUFDLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBRTNCLHVCQUF1QjtRQUN2QixJQUFJLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLENBQUM7WUFDM0IsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuRCxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxHQUFHLENBQUM7WUFDOUIsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUV6RCxzQkFBc0I7UUFDdEIsSUFBSSxZQUFZLENBQUMsT0FBTyxDQUFDLElBQUksR0FBRyxDQUFDO1lBQzdCLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDcEQsSUFBSSxZQUFZLENBQUMsVUFBVSxDQUFDLElBQUksR0FBRyxDQUFDO1lBQ2hDLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFMUQsb0JBQW9CO1FBQ3BCLElBQUksWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUMzQixNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2hELElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXRELE1BQU0sQ0FBQyxHQUFpQjtZQUNwQixJQUFJO1lBQ0osSUFBSTtZQUNKLE1BQU07WUFDTixNQUFNO1lBQ04sVUFBVTtZQUNWLElBQUksRUFBRSxRQUFRO1NBQ2pCLENBQUM7UUFFRixNQUFNLElBQUksR0FBa0IsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzlDLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDaEUsQ0FBQztDQUNKO0FBRUQsSUFBSyxXQUdKO0FBSEQsV0FBSyxXQUFXO0lBQ1osNEJBQWEsQ0FBQTtJQUNiLGdDQUFpQixDQUFBO0FBQ3JCLENBQUMsRUFISSxXQUFXLEtBQVgsV0FBVyxRQUdmO0FBRUQsS0FBSztJQUNELElBQUksS0FBSyxHQUFHO1FBQ1IsTUFBTSxFQUFFLE1BQU0sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUM3QyxRQUFRLEVBQUUsTUFBTSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1FBQ2pELFdBQVcsRUFBRSxNQUFNLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUM7S0FDMUQsQ0FBQztJQUVGLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUU7UUFDeEQsTUFBTSxXQUFXLEdBQUcsNEJBQVksQ0FBQztZQUM3QixPQUFPLEVBQUUsb0JBQW9CO1NBQ2hDLENBQUMsQ0FBQztRQUVILElBQUk7WUFDQSxNQUFNLEdBQUcsR0FBRyxNQUFNLFdBQVcsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEVBQUU7Z0JBQ3BELElBQUksRUFBRSx3QkFBd0I7Z0JBQzlCLFFBQVEsRUFBRSxrQkFBa0I7Z0JBQzVCLDJCQUEyQixFQUFFLHNCQUFzQjthQUN0RCxDQUFDLENBQUM7WUFFSCxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDM0MsTUFBTSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNuRCxNQUFNLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3ZELE1BQU0sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7WUFFN0QsS0FBSyxHQUFHO2dCQUNKLE1BQU0sRUFBRSxHQUFHLENBQUMsT0FBTztnQkFDbkIsUUFBUSxFQUFFLEdBQUcsQ0FBQyxTQUFTO2dCQUN2QixXQUFXLEVBQUUsR0FBRyxDQUFDLFlBQVk7YUFDaEMsQ0FBQztTQUNMO1FBQUMsT0FBTyxHQUFHLEVBQUU7WUFDVixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixDQUFDLENBQUM7WUFDNUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQixPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ25CO0tBQ0o7SUFFRCxNQUFNLEdBQUcsR0FBRyw0QkFBWSxpQkFDcEIsT0FBTyxFQUFFLG9CQUFvQixFQUM3QixTQUFTLEVBQUUsRUFBRSxJQUNWLEtBQUssSUFDUixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLGtDQUFrQztRQUNsQyw4QkFBOEI7UUFDOUIsNEJBQTRCO1FBQzVCLG9DQUFvQztRQUNwQyx5Q0FBeUM7UUFDekMsTUFBTTtRQUNOLEtBQUssRUFBRSxJQUFJLG1DQUFtQixDQUFDO1lBQzNCLFlBQVksRUFBRSxNQUFNLENBQUMsWUFBWTtTQUNwQyxDQUFDLEVBQ0YsWUFBWSxFQUFFLElBQUksc0NBQXNCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUMvRCxDQUFDO0lBRUgsR0FBRyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxLQUFrQixFQUFFLEVBQUU7UUFDbkMsSUFBSSxLQUFLLENBQUMsV0FBVyxFQUFFO1lBQUUsT0FBTztRQUNoQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUM7SUFDekMsQ0FBQyxDQUFDLENBQUM7SUFDSCxHQUFHLENBQUMsRUFBRSxDQUFDLGlCQUFpQixFQUFFLENBQUMsS0FBa0IsRUFBRSxFQUFFO1FBQzdDLElBQUksS0FBSyxDQUFDLG1CQUFtQixFQUFFLEVBQUU7WUFDN0IsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDMUIsT0FBTztTQUNWO1FBQ0QsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDO0lBQ3pDLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSTtRQUNBLE1BQU0sR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDO0tBQzFCO0lBQUMsT0FBTyxDQUFDLEVBQUU7UUFDUixPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0tBQ2xCO0lBQ0QsR0FBRyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRWxCLE1BQU0sR0FBRyxHQUFHLGlCQUFPLEVBQUUsQ0FBQztJQUN0QixHQUFHLENBQUMsR0FBRyxDQUFDLHFCQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUMzQixHQUFHLENBQUMsR0FBRyxDQUFDLGNBQUksQ0FBQztRQUNULGdCQUFnQixFQUFFLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQztRQUNsRCxnQkFBZ0IsRUFBRSxDQUFDLGNBQWMsQ0FBQztRQUNsQyxRQUFRLEVBQUUsR0FBRztRQUNiLFNBQVMsRUFBRSxNQUFNO1FBQ2pCLG1CQUFtQixFQUFFLEtBQUs7S0FDN0IsQ0FBQyxDQUFDLENBQUM7SUFFSixHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsR0FBWSxFQUFFLEdBQWEsRUFBRSxFQUFFO1FBQ3RELElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFO1lBQ1gsR0FBRyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQixPQUFPO1NBQ1Y7UUFFRCxJQUFJLFNBQVMsR0FBaUIsSUFBSSxDQUFDO1FBQ25DLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRTtZQUN6QixJQUFJO2dCQUNBLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzdELE9BQU8sQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsU0FBUyxDQUFDLENBQUM7YUFDbEQ7WUFBQyxPQUFPLENBQUMsRUFBRTtnQkFDUixPQUFPLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2FBQzNEO1NBQ0o7UUFFRCxtREFBbUQ7UUFDbkQsSUFBSTtZQUNBLE1BQU0sUUFBUSxHQUF3QixHQUFHLENBQUMsSUFBSSxDQUFDO1lBQy9DLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUM7WUFFdkQsSUFBSSxDQUFDLE9BQU8sRUFBRTtnQkFDVixHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNwQixPQUFPO2FBQ1Y7WUFFRCxJQUFJLElBQUksR0FBc0IsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsZ0NBQWdDO1lBQ3BILElBQUksT0FBTyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU07Z0JBQUUsSUFBSSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUM7WUFFN0QsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDO1lBQ3ZELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUU5QyxJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUM7WUFDMUIsSUFBSSxhQUFhLEdBQUcsS0FBSyxDQUFDO1lBQzFCLElBQUksT0FBTyxDQUFDLFNBQVMsSUFBSSxPQUFPLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRTtnQkFDakQsT0FBTyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFO29CQUMxQyxRQUFRLFFBQVEsQ0FBQyxHQUFHLEVBQUU7d0JBQ2xCLEtBQUssZUFBZSxDQUFDLE1BQU07NEJBQ3ZCLGFBQWEsR0FBRyxJQUFJLENBQUM7NEJBQ3JCLE1BQU07d0JBQ1YsS0FBSyxlQUFlLENBQUMsTUFBTTs0QkFDdkIsYUFBYSxHQUFHLElBQUksQ0FBQzs0QkFDckIsTUFBTTtxQkFDYjtnQkFDTCxDQUFDLENBQUMsQ0FBQzthQUNOO1lBRUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLDZDQUE2QztZQUVwRyw0REFBNEQ7WUFDNUQsc0NBQXNDO1lBQ3RDLGdFQUFnRTtZQUNoRSxFQUFFO1lBQ0YsNEJBQTRCO1lBQzVCLGlCQUFpQjtZQUNqQiwrQkFBK0I7WUFDL0IsNkJBQTZCO1lBQzdCLGtDQUFrQztZQUNsQywrQkFBK0I7WUFDL0IsNEJBQTRCO1lBQzVCLGlCQUFpQjtZQUNqQixhQUFhO1lBQ2IsVUFBVTtZQUNWLGNBQWM7WUFDZCxJQUFJO1lBRUosZUFBZTtZQUNmLHNEQUFzRDtZQUV0RCxpQ0FBaUM7WUFDakMsdUVBQXVFO1lBQ3ZFLElBQUk7WUFFSix1QkFBdUI7WUFDdkIsaUNBQWlDO1lBQ2pDLDhCQUE4QjtZQUM5QiwyQkFBMkI7WUFDM0IsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7WUFDakQsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7WUFFbkQsSUFBSSxlQUFpQyxDQUFDO1lBRXRDLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7WUFFaEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDL0IsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBRTFDLElBQUksYUFBdUMsQ0FBQztZQUM1QyxJQUFJLEtBQUssR0FBVyxDQUFDLENBQUM7WUFFdEIsbURBQW1EO1lBQ25ELFFBQVEsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFO2dCQUN6QixLQUFLLE1BQU0sQ0FBQztnQkFDWixLQUFLLEVBQUU7b0JBQ0gsMERBQTBEO29CQUMxRCxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxXQUFXLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUUsWUFBWSxDQUFDLENBQUM7b0JBQy9HLE1BQU07Z0JBRVYsS0FBSyxRQUFRO29CQUNULE1BQU0sSUFBSSxHQUFHLFNBQVMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUN2RCxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxXQUFXLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsWUFBWSxDQUFDLENBQUM7b0JBQ3BILDBCQUEwQjtvQkFDMUIsTUFBTTtnQkFFVjtvQkFDSSxHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUNwQixPQUFPO2FBQ2Q7WUFFRCxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUMxQixHQUFHLENBQUMsSUFBSSxDQUFDO29CQUNMLGlCQUFpQixFQUFFO3dCQUNmLFdBQVcsRUFBRTs0QkFDVCxVQUFVLEVBQUUsRUFBRTs0QkFDZCxPQUFPLEVBQUUsRUFBRTs0QkFDWCxLQUFLLEVBQUUsQ0FBQzt5QkFDWDtxQkFDSjtpQkFDSixDQUFDLENBQUM7Z0JBQ0gsT0FBTzthQUNWO1lBRUQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1lBQzdDLE1BQU0sT0FBTyxHQUFrQixFQUFFLENBQUM7WUFFbEMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQXNCLEVBQUUsRUFBRTtnQkFDN0MsZ0NBQWdDO2dCQUNoQyxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFNBQWlCLEVBQUUsRUFBRTtvQkFDekMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN0QyxDQUFDLENBQUMsQ0FBQztnQkFFSCxNQUFNLEVBQUMsS0FBSyxFQUFFLEVBQUUsRUFBQyxHQUFHLEdBQUcsQ0FBQztnQkFFeEIsSUFBSSxhQUFhLEVBQUU7b0JBQ2YsSUFBSSxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztvQkFDdkMsSUFBSSxDQUFDLENBQUM7d0JBQUUsQ0FBQyxHQUFHLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDdEMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztvQkFDbEIsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQ3JDO2dCQUNELElBQUksYUFBYSxFQUFFO29CQUNmLElBQUksQ0FBQyxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7b0JBQ3pDLElBQUksQ0FBQyxDQUFDO3dCQUFFLENBQUMsR0FBRyxJQUFJLFVBQVUsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7b0JBQ3RDLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7b0JBQ2xCLFlBQVksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUN2QztnQkFFRCxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO2dCQUUxQix1QkFBdUI7Z0JBQ3ZCLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUMsS0FBSztvQkFDbkMsT0FBTyxDQUFDLElBQUksQ0FBQzt3QkFDVCxJQUFJLEVBQUUsR0FBRyxDQUFDLEtBQUs7d0JBQ2YsTUFBTSxFQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSzt3QkFDdkIsT0FBTyxFQUFFLEdBQUcsQ0FBQyxPQUFPO3FCQUN2QixDQUFDLENBQUM7WUFFWCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxFQUE4QixDQUFDO1lBQzNELElBQUksWUFBWSxFQUFFO2dCQUNkLCtFQUErRTtnQkFDL0UsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQWMsRUFBRSxFQUFFO29CQUM3QixNQUFNLElBQUksR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNqQyxJQUFJLElBQUksRUFBRTt3QkFDTixZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUE2QixFQUFFLEVBQUU7NEJBQ3JGLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFlLEVBQUUsRUFBRTtnQ0FDNUIsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQzs0QkFDakIsQ0FBQyxDQUFDLENBQUM7NEJBQ0gsT0FBTyxHQUFHLENBQUM7d0JBQ2YsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7cUJBQ1g7Z0JBQ0wsQ0FBQyxDQUFDLENBQUM7YUFDTjtZQUVELE1BQU0sSUFBSSxHQUF5QjtnQkFDL0IsaUJBQWlCLEVBQUUsRUFBRTthQUN4QixDQUFDO1lBQ0Ysa0VBQWtFO1lBQ2xFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEdBQUc7Z0JBQ2pDLFVBQVUsRUFBRSxrQkFBa0I7Z0JBQzlCLE9BQU87Z0JBQ1AsS0FBSzthQUNSLENBQUM7WUFFRixzRUFBc0U7WUFDdEUsSUFBSSxlQUFlO2dCQUFFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsVUFBVSxHQUFHLGVBQWUsQ0FBQztZQUNyRixJQUFJLFlBQVk7Z0JBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxLQUFLLEdBQUcsWUFBWSxDQUFDO1lBRTFFLElBQUksYUFBYSxJQUFJLGFBQWEsRUFBRTtnQkFDaEMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQW1DLENBQUM7Z0JBRXZGLElBQUksYUFBYSxFQUFFO29CQUNmLHdCQUF3QixDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO29CQUM5QyxJQUFJLENBQUMsaUJBQWlCLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsQ0FBQztpQkFDckY7Z0JBQ0QsSUFBSSxhQUFhLEVBQUU7b0JBQ2Ysd0JBQXdCLENBQUMsWUFBWSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7b0JBQ2hELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxDQUFDO2lCQUN2RjthQUNKO1lBR0QsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNoQixHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2YsT0FBTztTQUNWO1FBQUMsT0FBTyxDQUFDLEVBQUU7WUFDUixPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNqQztRQUVELEdBQUcsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDeEIsQ0FBQyxDQUFDLENBQUM7SUFFSCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUM7SUFDbEIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO1FBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksRUFBRSxDQUFDLENBQUM7SUFDMUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsa0JBQWtCO0FBQ2xCLHlCQUF5QjtBQUN6QixnQkFBZ0I7QUFFaEIsa0NBQWtDLEVBQWdDO0lBQzlELElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNWLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBYSxFQUFFLENBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBYSxFQUFFLEVBQUU7UUFDN0YseUNBQXlDO1FBQ3pDLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxFQUFFLENBQUM7SUFDbEIsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQ7SUFVSSxZQUFZLENBQVM7UUFDakIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLEdBQUcsQ0FBUyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztRQUN6QyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksR0FBRyxDQUFTLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1FBQ2hELElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQVMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7UUFDN0MsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBUyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztRQUNwRCxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksR0FBRyxDQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1FBQ3pDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxHQUFHLENBQVMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7UUFFaEQsSUFBSSxDQUFDLEtBQUssR0FBRyxPQUFPLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQzlELElBQUksQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7Q0FDSjtBQVFELElBQUssZUFHSjtBQUhELFdBQUssZUFBZTtJQUNoQixxQ0FBa0IsQ0FBQTtJQUNsQixvQ0FBaUIsQ0FBQTtBQUNyQixDQUFDLEVBSEksZUFBZSxLQUFmLGVBQWUsUUFHbkI7QUFVRCxJQUFLLFVBSUo7QUFKRCxXQUFLLFVBQVU7SUFDWCxtQ0FBcUIsQ0FBQTtJQUNyQixtQ0FBcUIsQ0FBQTtJQUNyQixxQ0FBdUIsQ0FBQTtBQUMzQixDQUFDLEVBSkksVUFBVSxLQUFWLFVBQVUsUUFJZCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7RXZlbnRDb250ZXh0LCBVc2VyUHJvZmlsZX0gZnJvbSBcIi4vdHlwaW5ncy9tYXRyaXgtanMtc2RrXCI7XG5cbmRlY2xhcmUgdmFyIGdsb2JhbDoge1xuICAgIE9sbTogYW55XG4gICAgbG9jYWxTdG9yYWdlPzogYW55XG4gICAgYXRvYjogKHN0cmluZykgPT4gc3RyaW5nO1xufTtcblxuLy8gaW1wb3J0ICogYXMgcmVxdWVzdCBmcm9tIFwicmVxdWVzdC1wcm9taXNlXCI7XG5pbXBvcnQge1JlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnN9IGZyb20gXCJyZXF1ZXN0LXByb21pc2VcIjtcbmltcG9ydCBjb3JzIGZyb20gJ2NvcnMnO1xuaW1wb3J0IGV4cHJlc3MsIHtSZXF1ZXN0LCBSZXNwb25zZX0gZnJvbSBcImV4cHJlc3NcIjtcbmltcG9ydCBib2R5UGFyc2VyIGZyb20gJ2JvZHktcGFyc2VyJztcbmltcG9ydCAqIGFzIG1rZGlycCBmcm9tIFwibWtkaXJwXCI7XG5cbmltcG9ydCB7UmVxdWVzdEFQSSwgUmVxdWlyZWRVcmlVcmx9IGZyb20gXCJyZXF1ZXN0XCI7XG4vLyBpbXBvcnQgc3FsaXRlMyBmcm9tICdzcWxpdGUzJztcblxuLy8gY29uc3QgaW5kZXhlZGRianMgPSByZXF1aXJlKCdpbmRleGVkZGItanMnKTtcbmNvbnN0IFF1ZXVlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlJyk7XG5jb25zdCBTcWxpdGVTdG9yZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZS1zcWxpdGUnKTtcbmNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0LXByb21pc2UnKTtcblxuY29uc3QgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL2xpYi9jcnlwdG8vc3RvcmUvbG9jYWxTdG9yYWdlLWNyeXB0by1zdG9yZScpLmRlZmF1bHQ7XG5cbi8vIGNyZWF0ZSBkaXJlY3Rvcnkgd2hpY2ggd2lsbCBob3VzZSB0aGUgc3RvcmVzLlxubWtkaXJwLnN5bmMoJy4vc3RvcmUnKTtcbi8vIExvYWRpbmcgbG9jYWxTdG9yYWdlIG1vZHVsZVxuaWYgKHR5cGVvZiBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBcInVuZGVmaW5lZFwiIHx8IGdsb2JhbC5sb2NhbFN0b3JhZ2UgPT09IG51bGwpXG4gICAgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9IG5ldyAocmVxdWlyZSgnbm9kZS1sb2NhbHN0b3JhZ2UnKS5Mb2NhbFN0b3JhZ2UpKCcuL3N0b3JlL2xvY2FsU3RvcmFnZScpO1xuXG4vLyBpbXBvcnQgT2xtIGJlZm9yZSBpbXBvcnRpbmcganMtc2RrIHRvIHByZXZlbnQgaXQgY3J5aW5nXG5nbG9iYWwuT2xtID0gcmVxdWlyZSgnb2xtJyk7XG5cbmltcG9ydCB7XG4gICAgUm9vbSxcbiAgICBFdmVudCxcbiAgICBNYXRyaXgsXG4gICAgTWF0cml4RXZlbnQsXG4gICAgY3JlYXRlQ2xpZW50LFxuICAgIE1hdHJpeENsaWVudCxcbiAgICBJbmRleGVkREJTdG9yZSxcbiAgICBFdmVudFdpdGhDb250ZXh0LFxuICAgIE1hdHJpeEluTWVtb3J5U3RvcmUsXG4gICAgSW5kZXhlZERCQ3J5cHRvU3RvcmUsXG4gICAgc2V0Q3J5cHRvU3RvcmVGYWN0b3J5LFxuICAgIFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUsXG59IGZyb20gJ21hdHJpeC1qcy1zZGsnO1xuXG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hdHJpeENsaWVudCBwcm90b3R5cGVcbmltcG9ydCAnLi9tYXRyaXhfY2xpZW50X2V4dCc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hcCBhbmQgU2V0IHByb3RvdHlwZXNcbmltcG9ydCAnLi9idWlsdGluX2V4dCc7XG5cbmxldCBpbmRleGVkREI7XG5cbi8vIGNvbnN0IGVuZ2luZSA9IG5ldyBzcWxpdGUzLkRhdGFiYXNlKCcuL3N0b3JlL2luZGV4ZWRiLnNxbGl0ZScpO1xuLy8gY29uc3Qgc2NvcGUgPSBpbmRleGVkZGJqcy5tYWtlU2NvcGUoJ3NxbGl0ZTMnLCBlbmdpbmUpO1xuLy8gaW5kZXhlZERCID0gc2NvcGUuaW5kZXhlZERCO1xuXG5pZiAoaW5kZXhlZERCKSB7XG4gICAgLy8gc2V0Q3J5cHRvU3RvcmVGYWN0b3J5KCgpID0+IG5ldyBJbmRleGVkREJDcnlwdG9TdG9yZShpbmRleGVkREIsICdtYXRyaXgtanMtc2RrOmNyeXB0bycpKTtcbiAgICAvLyBzZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IEluZGV4ZWREQkNyeXB0b1N0b3JlKG51bGwpKTtcbn0gZWxzZSB7XG4gICAgc2V0Q3J5cHRvU3RvcmVGYWN0b3J5KCgpID0+IG5ldyBMb2NhbFN0b3JhZ2VDcnlwdG9TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSk7XG59XG5cblxuY2xhc3MgQmxldmVIdHRwIHtcbiAgICByZXF1ZXN0OiBSZXF1ZXN0QVBJPFJlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnMsIFJlcXVpcmVkVXJpVXJsPjtcblxuICAgIGNvbnN0cnVjdG9yKGJhc2VVcmw6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlcXVlc3QgPSByZXF1ZXN0LmRlZmF1bHRzKHtcbiAgICAgICAgICAgIGJhc2VVcmwsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNlYXJjaChyZXE6IEJsZXZlUmVxdWVzdCl7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAncXVlcnknLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogcmVxLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpbmRleChldmVudHM6IEV2ZW50W10pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdpbmRleCcsXG4gICAgICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICAgICAganNvbjogdHJ1ZSxcbiAgICAgICAgICAgIGJvZHk6IGV2ZW50cyxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5jb25zdCBiID0gbmV3IEJsZXZlSHR0cChcImh0dHA6Ly9sb2NhbGhvc3Q6OTk5OS9hcGkvXCIpO1xuXG5jb25zdCBxID0gbmV3IFF1ZXVlKGFzeW5jIChiYXRjaDogRXZlbnRbXSwgY2IpID0+IHtcbiAgICB0cnkge1xuICAgICAgICBjYihudWxsLCBhd2FpdCBiLmluZGV4KGJhdGNoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYihlKTtcbiAgICB9XG59LCB7XG4gICAgYmF0Y2hTaXplOiAxMDAsXG4gICAgbWF4UmV0cmllczogMTAsXG4gICAgcmV0cnlEZWxheTogMTAwMCxcbiAgICBzdG9yZTogbmV3IFNxbGl0ZVN0b3JlKHtcbiAgICAgICAgcGF0aDogJy4vc3RvcmUvcXVldWUuc3FsaXRlJyxcbiAgICB9KSxcbiAgICBmaWx0ZXI6IChldmVudDogRXZlbnQsIGNiKSA9PiB7XG4gICAgICAgIGlmIChldmVudC50eXBlICE9PSAnbS5yb29tLm1lc3NhZ2UnKSByZXR1cm4gY2IoJ25vdCBtLnJvb20ubWVzc2FnZScpO1xuICAgICAgICByZXR1cm4gY2IobnVsbCwgZXZlbnQpO1xuICAgIH1cbn0pO1xuXG5xLm9uKCd0YXNrX2FjY2VwdGVkJywgZnVuY3Rpb24odGFza0lkOiBzdHJpbmcsIGV2OiBFdmVudCkge1xuICAgIGNvbnNvbGUuaW5mbyhgRW5xdWV1ZSBldmVudCAke2V2LnJvb21faWR9LyR7ZXYuZXZlbnRfaWR9ICR7ZXYuc2VuZGVyfSBbJHtldi50eXBlfV0gKCR7dGFza0lkfSlgKTtcbn0pO1xuXG5xLm9uKCdiYXRjaF9mYWlsZWQnLCBmdW5jdGlvbihlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW0VSUk9SXSBCYXRjaCBmYWlsZWQ6IFwiLCBlcnIpO1xufSk7XG5cbnNldHVwKCkudGhlbihjb25zb2xlLmxvZykuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbmludGVyZmFjZSBHcm91cFZhbHVlSlNPTiB7XG4gICAgb3JkZXI6IG51bWJlcjtcbiAgICBuZXh0X2JhdGNoPzogc3RyaW5nO1xuICAgIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG59XG5cbmNsYXNzIEdyb3VwVmFsdWUge1xuICAgIHB1YmxpYyBvcmRlcjogbnVtYmVyO1xuICAgIHB1YmxpYyBuZXh0X2JhdGNoOiBzdHJpbmc7XG4gICAgcHVibGljIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG5cbiAgICBjb25zdHJ1Y3RvcihvcmRlcjogbnVtYmVyKSB7XG4gICAgICAgIHRoaXMub3JkZXIgPSBvcmRlcjtcbiAgICAgICAgdGhpcy5uZXh0X2JhdGNoID0gXCJcIjtcbiAgICAgICAgdGhpcy5yZXN1bHRzID0gW107XG4gICAgfVxuXG4gICAgYWRkKGV2ZW50SWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlc3VsdHMucHVzaChldmVudElkKTtcbiAgICB9XG5cbiAgICAvLyBkb24ndCBzZW5kIG5leHRfYmF0Y2ggaWYgaXQgaXMgZW1wdHlcbiAgICB0b0pTT04oKTogR3JvdXBWYWx1ZUpTT04ge1xuICAgICAgICBjb25zdCBvOiBHcm91cFZhbHVlSlNPTiA9IHtcbiAgICAgICAgICAgIG9yZGVyOiB0aGlzLm9yZGVyLFxuICAgICAgICAgICAgcmVzdWx0czogdGhpcy5yZXN1bHRzLFxuICAgICAgICB9O1xuICAgICAgICBpZiAodGhpcy5uZXh0X2JhdGNoKSBvLm5leHRfYmF0Y2ggPSB0aGlzLm5leHRfYmF0Y2g7XG4gICAgICAgIHJldHVybiBvO1xuICAgIH1cbn1cblxuY2xhc3MgQmF0Y2gge1xuICAgIHB1YmxpYyBUb2tlbjogbnVtYmVyO1xuICAgIHB1YmxpYyBHcm91cDogc3RyaW5nO1xuICAgIHB1YmxpYyBHcm91cEtleTogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3IoVG9rZW46IG51bWJlciA9IDAsIEdyb3VwOiBzdHJpbmcsIEdyb3VwS2V5OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5Ub2tlbiA9IFRva2VuO1xuICAgICAgICB0aGlzLkdyb3VwID0gR3JvdXA7XG4gICAgICAgIHRoaXMuR3JvdXBLZXkgPSBHcm91cEtleTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZnJvbVN0cmluZyhmcm9tOiBzdHJpbmcpOiBCYXRjaCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvID0gSlNPTi5wYXJzZShmcm9tKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IGIgPSBuZXcgQmF0Y2gobyk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmcm9tKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5Ub2tlbjtcbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIFRva2VuOiB0aGlzLlRva2VuLFxuICAgICAgICAgICAgR3JvdXA6IHRoaXMuR3JvdXAsXG4gICAgICAgICAgICBHcm91cEtleTogdGhpcy5Hcm91cEtleSxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgUXVlcnkge1xuICAgIG11c3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gICAgc2hvdWxkPzogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICAgIG11c3ROb3Q/OiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlcXVlc3Qge1xuICAgIGtleXM6IEFycmF5PHN0cmluZz47XG4gICAgZmlsdGVyOiBRdWVyeTtcbiAgICBzb3J0Qnk6IFNlYXJjaE9yZGVyO1xuICAgIHNlYXJjaFRlcm06IHN0cmluZztcbiAgICBmcm9tOiBudW1iZXI7XG4gICAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBwYWdlU2l6ZSA9IDEwO1xuXG5pbnRlcmZhY2UgQmxldmVSZXNwb25zZVJvdyB7XG4gICAgcm9vbUlkOiBzdHJpbmc7XG4gICAgZXZlbnRJZDogc3RyaW5nO1xuICAgIHNjb3JlOiBudW1iZXI7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlIHtcbiAgICByb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PjtcbiAgICB0b3RhbDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXZlbnRMb29rdXBSZXN1bHQge1xuICAgIGV2ZW50OiBNYXRyaXhFdmVudDtcbiAgICBzY29yZTogbnVtYmVyO1xuICAgIHN0YXRlPzogQXJyYXk8TWF0cml4RXZlbnQ+O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBSZXN1bHQge1xuICAgIHJhbms6IG51bWJlcjtcbiAgICByZXN1bHQ6IEV2ZW50O1xuICAgIGNvbnRleHQ/OiBFdmVudENvbnRleHQ7XG59XG5cbmNsYXNzIFNlYXJjaCB7XG4gICAgY2xpOiBNYXRyaXhDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcihjbGk6IE1hdHJpeENsaWVudCkge1xuICAgICAgICB0aGlzLmNsaSA9IGNsaTtcbiAgICB9XG5cbiAgICAvLyBpbXBlZGFuY2UgbWF0Y2hpbmcuXG4gICAgYXN5bmMgcmVzb2x2ZU9uZShyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nLCBjb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dCk6IFByb21pc2U8W0V2ZW50LCBFdmVudENvbnRleHR8dW5kZWZpbmVkXT4ge1xuICAgICAgICBpZiAoY29udGV4dCkge1xuICAgICAgICAgICAgY29uc3QgbGltaXQgPSBNYXRoLm1heChjb250ZXh0LmFmdGVyX2xpbWl0IHx8IDAsIGNvbnRleHQuYmVmb3JlX2xpbWl0IHx8IDAsIDMpO1xuICAgICAgICAgICAgY29uc3QgZXZjID0gYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudENvbnRleHQocm9vbUlkLCBldmVudElkLCBsaW1pdCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHtzdGFydCwgZW5kLCBldmVudHNfYmVmb3JlLCBldmVudHNfYWZ0ZXIsIHN0YXRlfSA9IGV2Yy5jb250ZXh0O1xuICAgICAgICAgICAgY29uc3QgY3R4OiBFdmVudENvbnRleHQgPSB7XG4gICAgICAgICAgICAgICAgc3RhcnQsXG4gICAgICAgICAgICAgICAgZW5kLFxuICAgICAgICAgICAgICAgIHByb2ZpbGVfaW5mbzogbmV3IE1hcDxzdHJpbmcsIFVzZXJQcm9maWxlPigpLFxuICAgICAgICAgICAgICAgIGV2ZW50c19iZWZvcmU6IGV2ZW50c19iZWZvcmUubWFwKChldjogTWF0cml4RXZlbnQpID0+IGV2LmV2ZW50KSxcbiAgICAgICAgICAgICAgICBldmVudHNfYWZ0ZXI6IGV2ZW50c19hZnRlci5tYXAoKGV2OiBNYXRyaXhFdmVudCkgPT4gZXYuZXZlbnQpLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgdXNlcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIFsuLi5ldmVudHNfYmVmb3JlLCBldmMuZXZlbnQsIC4uLmV2ZW50c19hZnRlcl0uZm9yRWFjaCgoZXY6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgdXNlcnMuYWRkKGV2LmdldFNlbmRlcigpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBzdGF0ZS5mb3JFYWNoKChldjogRXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXYudHlwZSA9PT0gJ20ucm9vbS5tZW1iZXInICYmIHVzZXJzLmhhcyhldi5zdGF0ZV9rZXkpKVxuICAgICAgICAgICAgICAgICAgICBjdHgucHJvZmlsZV9pbmZvLnNldChldi5zdGF0ZV9rZXksIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3BsYXluYW1lOiBldi5jb250ZW50WydkaXNwbGF5bmFtZSddLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXZhdGFyX3VybDogZXYuY29udGVudFsnYXZhdGFyX3VybCddLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gW2V2Yy5ldmVudCwgY3R4XTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudChyb29tSWQsIGV2ZW50SWQpLCB1bmRlZmluZWRdO1xuICAgIH1cblxuICAgIGFzeW5jIHJlc29sdmUocm93czogQXJyYXk8QmxldmVSZXNwb25zZVJvdz4sIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxBcnJheTxFdmVudExvb2t1cFJlc3VsdD4+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+ID0gW107XG5cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGw8dm9pZD4ocm93cy5tYXAoYXN5bmMgKHJvdzogQmxldmVSZXNwb25zZVJvdyk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbZXYsIGN0eF0gPSBhd2FpdCB0aGlzLnJlc29sdmVPbmUocm93LnJvb21JZCwgcm93LmV2ZW50SWQsIGNvbnRleHQpO1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGV2ZW50OiBldixcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dDogY3R4LFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogcm93LnNjb3JlLFxuICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiByb3cuaGlnaGxpZ2h0cyxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgIH0pKTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcGFyYW0ga2V5cyB7c3RyaW5nfSBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc2VhcmNoRmlsdGVyIHtGaWx0ZXJ9IGNvbXB1dGUgYW5kIHNlbmQgcXVlcnkgcnVsZXMgdG8gZ28tYmxldmVcbiAgICAgKiBAcGFyYW0gc29ydEJ5IHtTZWFyY2hPcmRlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIHNlYXJjaFRlcm0ge3N0cmluZ30gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGZyb20ge251bWJlcn0gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIGNvbnRleHQ/IHtSZXF1ZXN0RXZlbnRDb250ZXh0fSBpZiBkZWZpbmVkIHVzZSB0byBmZXRjaCBjb250ZXh0IGFmdGVyIGdvLWJsZXZlIGNhbGxcbiAgICAgKi9cbiAgICBhc3luYyBxdWVyeShrZXlzOiBBcnJheTxzdHJpbmc+LCBzZWFyY2hGaWx0ZXI6IEZpbHRlciwgc29ydEJ5OiBTZWFyY2hPcmRlciwgc2VhcmNoVGVybTogc3RyaW5nLCBmcm9tOiBudW1iZXIsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+LCBudW1iZXJdPiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcjogUXVlcnkgPSB7fTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIGZpZWxkcyB3ZSB3aWxsIHVzZSAod2UgZG9uJ3QgdXNlIHNob3VsZCBjdXJyZW50bHkpXG4gICAgICAgIGZpbHRlci5tdXN0ID0gbmV3IE1hcCgpO1xuICAgICAgICBmaWx0ZXIubXVzdE5vdCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgcm9vbV9pZFxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdyb29tX2lkJywgc2VhcmNoRmlsdGVyLnJvb21zKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RSb29tcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0Tm90LnNldCgncm9vbV9pZCcsIHNlYXJjaEZpbHRlci5ub3RSb29tcyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHNlbmRlclxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3NlbmRlcicsIHNlYXJjaEZpbHRlci5zZW5kZXJzKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdzZW5kZXInLCBzZWFyY2hGaWx0ZXIubm90U2VuZGVycyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHR5cGVcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci50eXBlcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0LnNldCgndHlwZScsIHNlYXJjaEZpbHRlci50eXBlcyk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90VHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3R5cGUnLCBzZWFyY2hGaWx0ZXIubm90VHlwZXMpO1xuXG4gICAgICAgIGNvbnN0IHI6IEJsZXZlUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGZyb20sXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgZmlsdGVyLFxuICAgICAgICAgICAgc29ydEJ5LFxuICAgICAgICAgICAgc2VhcmNoVGVybSxcbiAgICAgICAgICAgIHNpemU6IHBhZ2VTaXplLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3A6IEJsZXZlUmVzcG9uc2UgPSBhd2FpdCBiLnNlYXJjaChyKTtcbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLnJlc29sdmUocmVzcC5yb3dzLCBjb250ZXh0KSwgcmVzcC50b3RhbF07XG4gICAgfVxufVxuXG5lbnVtIFNlYXJjaE9yZGVyIHtcbiAgICBSYW5rID0gJ3JhbmsnLFxuICAgIFJlY2VudCA9ICdyZWNlbnQnLFxufVxuXG5hc3luYyBmdW5jdGlvbiBzZXR1cCgpIHtcbiAgICBsZXQgY3JlZHMgPSB7XG4gICAgICAgIHVzZXJJZDogZ2xvYmFsLmxvY2FsU3RvcmFnZS5nZXRJdGVtKCd1c2VySWQnKSxcbiAgICAgICAgZGV2aWNlSWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGV2aWNlSWQnKSxcbiAgICAgICAgYWNjZXNzVG9rZW46IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnYWNjZXNzVG9rZW4nKSxcbiAgICB9O1xuXG4gICAgaWYgKCFjcmVkcy51c2VySWQgfHwgIWNyZWRzLmRldmljZUlkIHx8ICFjcmVkcy5hY2Nlc3NUb2tlbikge1xuICAgICAgICBjb25zdCBsb2dpbkNsaWVudCA9IGNyZWF0ZUNsaWVudCh7XG4gICAgICAgICAgICBiYXNlVXJsOiAnaHR0cHM6Ly9tYXRyaXgub3JnJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGxvZ2luQ2xpZW50LmxvZ2luKCdtLmxvZ2luLnBhc3N3b3JkJywge1xuICAgICAgICAgICAgICAgIHVzZXI6ICdAd2ViZGV2Z3VydTptYXRyaXgub3JnJyxcbiAgICAgICAgICAgICAgICBwYXNzd29yZDogJ3RsRCRANVpDVVc0MVkjSGcnLFxuICAgICAgICAgICAgICAgIGluaXRpYWxfZGV2aWNlX2Rpc3BsYXlfbmFtZTogJ01hdHJpeCBTZWFyY2ggRGFlbW9uJyxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTG9nZ2VkIGluIGFzICcgKyByZXMudXNlcl9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ3VzZXJJZCcsIHJlcy51c2VyX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnZGV2aWNlSWQnLCByZXMuZGV2aWNlX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnYWNjZXNzVG9rZW4nLCByZXMuYWNjZXNzX3Rva2VuKTtcblxuICAgICAgICAgICAgY3JlZHMgPSB7XG4gICAgICAgICAgICAgICAgdXNlcklkOiByZXMudXNlcl9pZCxcbiAgICAgICAgICAgICAgICBkZXZpY2VJZDogcmVzLmRldmljZV9pZCxcbiAgICAgICAgICAgICAgICBhY2Nlc3NUb2tlbjogcmVzLmFjY2Vzc190b2tlbixcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0FuIGVycm9yIG9jY3VyZWQgbG9nZ2luZyBpbiEnKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGVycik7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGkgPSBjcmVhdGVDbGllbnQoe1xuICAgICAgICBiYXNlVXJsOiAnaHR0cHM6Ly9tYXRyaXgub3JnJyxcbiAgICAgICAgaWRCYXNlVXJsOiAnJyxcbiAgICAgICAgLi4uY3JlZHMsXG4gICAgICAgIHVzZUF1dGhvcml6YXRpb25IZWFkZXI6IHRydWUsXG4gICAgICAgIC8vIHNlc3Npb25TdG9yZTogbmV3IExldmVsU3RvcmUoKSxcbiAgICAgICAgLy8gc3RvcmU6IG5ldyBJbmRleGVkREJTdG9yZSh7XG4gICAgICAgIC8vICAgICBpbmRleGVkREI6IGluZGV4ZWREQixcbiAgICAgICAgLy8gICAgIGRiTmFtZTogJ21hdHJpeC1zZWFyY2gtc3luYycsXG4gICAgICAgIC8vICAgICBsb2NhbFN0b3JhZ2U6IGdsb2JhbC5sb2NhbFN0b3JhZ2UsXG4gICAgICAgIC8vIH0pLFxuICAgICAgICBzdG9yZTogbmV3IE1hdHJpeEluTWVtb3J5U3RvcmUoe1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlOiBnbG9iYWwubG9jYWxTdG9yYWdlLFxuICAgICAgICB9KSxcbiAgICAgICAgc2Vzc2lvblN0b3JlOiBuZXcgV2ViU3RvcmFnZVNlc3Npb25TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSxcbiAgICB9KTtcblxuICAgIGNsaS5vbignZXZlbnQnLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5pc0VuY3J5cHRlZCgpKSByZXR1cm47XG4gICAgICAgIHJldHVybiBxLnB1c2goZXZlbnQuZ2V0Q2xlYXJFdmVudCgpKTtcbiAgICB9KTtcbiAgICBjbGkub24oJ0V2ZW50LmRlY3J5cHRlZCcsIChldmVudDogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmlzRGVjcnlwdGlvbkZhaWx1cmUoKSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGV2ZW50LmV2ZW50KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcS5wdXNoKGV2ZW50LmdldENsZWFyRXZlbnQoKSk7XG4gICAgfSk7XG5cbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBjbGkuaW5pdENyeXB0bygpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coZSk7XG4gICAgfVxuICAgIGNsaS5zdGFydENsaWVudCgpO1xuXG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGFwcC51c2UoYm9keVBhcnNlci5qc29uKCkpO1xuICAgIGFwcC51c2UoY29ycyh7XG4gICAgICAgICdhbGxvd2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJywgJ0NvbnRlbnQtVHlwZSddLFxuICAgICAgICAnZXhwb3NlZEhlYWRlcnMnOiBbJ2FjY2Vzc190b2tlbiddLFxuICAgICAgICAnb3JpZ2luJzogJyonLFxuICAgICAgICAnbWV0aG9kcyc6ICdQT1NUJyxcbiAgICAgICAgJ3ByZWZsaWdodENvbnRpbnVlJzogZmFsc2VcbiAgICB9KSk7XG5cbiAgICBhcHAucG9zdCgnL3NlYXJjaCcsIGFzeW5jIChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFyZXEuYm9keSkge1xuICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNDAwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBuZXh0QmF0Y2g6IEJhdGNoIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGlmIChyZXEucXVlcnlbJ25leHRfYmF0Y2gnXSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBuZXh0QmF0Y2ggPSBKU09OLnBhcnNlKGdsb2JhbC5hdG9iKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKFwiRm91bmQgbmV4dCBiYXRjaCBvZlwiLCBuZXh0QmF0Y2gpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gcGFyc2UgbmV4dF9iYXRjaCBhcmd1bWVudFwiLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZlcmlmeSB0aGF0IHVzZXIgaXMgYWxsb3dlZCB0byBhY2Nlc3MgdGhpcyB0aGluZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY2FzdEJvZHk6IE1hdHJpeFNlYXJjaFJlcXVlc3QgPSByZXEuYm9keTtcbiAgICAgICAgICAgIGNvbnN0IHJvb21DYXQgPSBjYXN0Qm9keS5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cztcblxuICAgICAgICAgICAgaWYgKCFyb29tQ2F0KSB7XG4gICAgICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAxKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBrZXlzOiBBcnJheTxSZXF1ZXN0S2V5PiA9IFtSZXF1ZXN0S2V5LmJvZHksIFJlcXVlc3RLZXkubmFtZSwgUmVxdWVzdEtleS50b3BpY107IC8vIGRlZmF1bHQgdmFsdWUgZm9yIHJvb21DYXQua2V5XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5rZXlzICYmIHJvb21DYXQua2V5cy5sZW5ndGgpIGtleXMgPSByb29tQ2F0LmtleXM7XG5cbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGVTdGF0ZSA9IEJvb2xlYW4ocm9vbUNhdFsnaW5jbHVkZV9zdGF0ZSddKTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50Q29udGV4dCA9IHJvb21DYXRbJ2V2ZW50X2NvbnRleHQnXTtcblxuICAgICAgICAgICAgbGV0IGdyb3VwQnlSb29tSWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxldCBncm91cEJ5U2VuZGVyID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5ncm91cGluZ3MgJiYgcm9vbUNhdC5ncm91cGluZ3MuZ3JvdXBfYnkpIHtcbiAgICAgICAgICAgICAgICByb29tQ2F0Lmdyb3VwaW5ncy5ncm91cF9ieS5mb3JFYWNoKGdyb3VwaW5nID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChncm91cGluZy5rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnJvb21JZDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5Um9vbUlkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnNlbmRlcjpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5U2VuZGVyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXIgPSBuZXcgRmlsdGVyKHJvb21DYXQuZmlsdGVyIHx8IHt9KTsgLy8gZGVmYXVsdCB0byBlbXB0eSBvYmplY3QgdG8gYXNzdW1lIGRlZmF1bHRzXG5cbiAgICAgICAgICAgIC8vIFRPRE8gdGhpcyBpcyByZW1vdmVkIGJlY2F1c2Ugcm9vbXMgc3RvcmUgaXMgdW5yZWxpYWJsZSBBRlxuICAgICAgICAgICAgLy8gY29uc3Qgam9pbmVkUm9vbXMgPSBjbGkuZ2V0Um9vbXMoKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IHJvb21JZHMgPSBqb2luZWRSb29tcy5tYXAoKHJvb206IFJvb20pID0+IHJvb20ucm9vbUlkKTtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyBpZiAocm9vbUlkcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAvLyAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgLy8gICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgfSk7XG4gICAgICAgICAgICAvLyAgICAgcmV0dXJuO1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICAvLyBTS0lQIGZvciBub3dcbiAgICAgICAgICAgIC8vIGxldCByb29tSWRzU2V0ID0gc2VhcmNoRmlsdGVyLmZpbHRlclJvb21zKHJvb21JZHMpO1xuXG4gICAgICAgICAgICAvLyBpZiAoYi5pc0dyb3VwaW5nKFwicm9vbV9pZFwiKSkge1xuICAgICAgICAgICAgLy8gICAgIHJvb21JRHNTZXQuSW50ZXJzZWN0KGNvbW1vbi5OZXdTdHJpbmdTZXQoW11zdHJpbmd7KmIuR3JvdXBLZXl9KSlcbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgLy8gVE9ETyBkbyB3ZSBuZWVkIHRoaXNcbiAgICAgICAgICAgIC8vcmFua01hcCA6PSBtYXBbc3RyaW5nXWZsb2F0NjR7fVxuICAgICAgICAgICAgLy9hbGxvd2VkRXZlbnRzIDo9IFtdKlJlc3VsdHt9XG4gICAgICAgICAgICAvLyBUT0RPIHRoZXNlIG5lZWQgY2hhbmdpbmdcbiAgICAgICAgICAgIGNvbnN0IHJvb21Hcm91cHMgPSBuZXcgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4oKTtcbiAgICAgICAgICAgIGNvbnN0IHNlbmRlckdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuXG4gICAgICAgICAgICBsZXQgZ2xvYmFsTmV4dEJhdGNoOiBzdHJpbmd8dW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBjb25zdCByb29tcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2ggPSBuZXcgU2VhcmNoKGNsaSk7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hUZXJtID0gcm9vbUNhdFsnc2VhcmNoX3Rlcm0nXTtcblxuICAgICAgICAgICAgbGV0IGFsbG93ZWRFdmVudHM6IEFycmF5PEV2ZW50TG9va3VwUmVzdWx0PjtcbiAgICAgICAgICAgIGxldCBjb3VudDogbnVtYmVyID0gMDtcblxuICAgICAgICAgICAgLy8gVE9ETyBleHRlbmQgbG9jYWwgZXZlbnQgbWFwIHVzaW5nIHNxbGl0ZS9sZXZlbGRiXG4gICAgICAgICAgICBzd2l0Y2ggKHJvb21DYXRbJ29yZGVyX2J5J10pIHtcbiAgICAgICAgICAgICAgICBjYXNlICdyYW5rJzpcbiAgICAgICAgICAgICAgICBjYXNlICcnOlxuICAgICAgICAgICAgICAgICAgICAvLyBnZXQgbWVzc2FnZXMgZnJvbSBCbGV2ZSBieSByYW5rIC8vIHJlc29sdmUgdGhlbSBsb2NhbGx5XG4gICAgICAgICAgICAgICAgICAgIFthbGxvd2VkRXZlbnRzLCBjb3VudF0gPSBhd2FpdCBzZWFyY2gucXVlcnkoa2V5cywgc2VhcmNoRmlsdGVyLCBTZWFyY2hPcmRlci5SYW5rLCBzZWFyY2hUZXJtLCAwLCBldmVudENvbnRleHQpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ3JlY2VudCc6XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSBuZXh0QmF0Y2ggIT09IG51bGwgPyBuZXh0QmF0Y2guZnJvbSgpIDogMDtcbiAgICAgICAgICAgICAgICAgICAgW2FsbG93ZWRFdmVudHMsIGNvdW50XSA9IGF3YWl0IHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJlY2VudCwgc2VhcmNoVGVybSwgZnJvbSwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBnZXQgbmV4dCBiYWNrIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDEpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhbGxvd2VkRXZlbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGhpZ2hsaWdodHNTdXBlcnNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8UmVzdWx0PiA9IFtdO1xuXG4gICAgICAgICAgICBhbGxvd2VkRXZlbnRzLmZvckVhY2goKHJvdzogRXZlbnRMb29rdXBSZXN1bHQpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYWxjdWxhdGUgaGlnaHRsaWdodHNTdXBlcnNldFxuICAgICAgICAgICAgICAgIHJvdy5oaWdobGlnaHRzLmZvckVhY2goKGhpZ2hsaWdodDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHNTdXBlcnNldC5hZGQoaGlnaGxpZ2h0KTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHtldmVudDogZXZ9ID0gcm93O1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHYgPSByb29tR3JvdXBzLmdldChldi5nZXRSb29tSWQoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICByb29tR3JvdXBzLnNldChldi5nZXRSb29tSWQoKSwgdik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gc2VuZGVyR3JvdXBzLmdldChldi5nZXRTZW5kZXIoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICBzZW5kZXJHcm91cHMuc2V0KGV2LmdldFNlbmRlcigpLCB2KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByb29tcy5hZGQoZXYuZ2V0Um9vbUlkKCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gYWRkIHRvIHJlc3VsdHMgYXJyYXlcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPCBzZWFyY2hGaWx0ZXIubGltaXQpXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICByYW5rOiByb3cuc2NvcmUsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJvdy5ldmVudC5ldmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQ6IHJvdy5jb250ZXh0LFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21TdGF0ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTxNYXRyaXhFdmVudD4+KCk7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETyBmZXRjaCBzdGF0ZSBmcm9tIHNlcnZlciB1c2luZyBBUEkgYmVjYXVzZSBqcy1zZGsgaXMgYnJva2VuIGR1ZSB0byBzdG9yZVxuICAgICAgICAgICAgICAgIHJvb21zLmZvckVhY2goKHJvb21JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvb20gPSBjbGkuZ2V0Um9vbShyb29tSWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocm9vbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbVN0YXRlTWFwLnNldChyb29tSWQsIHJvb20uY3VycmVudFN0YXRlLnJlZHVjZSgoYWNjLCBtYXA6IE1hcDxzdHJpbmcsIE1hdHJpeEV2ZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjLnB1c2goZXYpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBbXSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3A6IE1hdHJpeFNlYXJjaFJlc3BvbnNlID0ge1xuICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7fSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvLyBzcGxpdCB0byBtYWtlIFR5cGVTY3JpcHQgaGFwcHkgd2l0aCB0aGUgaWYgc3RhdGVtZW50cyBmb2xsb3dpbmdcbiAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMgPSB7XG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogaGlnaGxpZ2h0c1N1cGVyc2V0LFxuICAgICAgICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgICAgICAgY291bnQsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBvbWl0ZW1wdHkgYmVoYXZpb3VyIHVzaW5nIGlmIHRvIGF0dGFjaCBvbnRvIG9iamVjdCB0byBiZSBzZXJpYWxpemVkXG4gICAgICAgICAgICBpZiAoZ2xvYmFsTmV4dEJhdGNoKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLm5leHRfYmF0Y2ggPSBnbG9iYWxOZXh0QmF0Y2g7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLnN0YXRlID0gcm9vbVN0YXRlTWFwO1xuXG4gICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCB8fCBncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5ncm91cHMgPSBuZXcgTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+KCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCkge1xuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIocm9vbUdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkucm9vbUlkLCByb29tR3JvdXBzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlTZW5kZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplR3JvdXBWYWx1ZU9yZGVyKHNlbmRlckdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkuc2VuZGVyLCBzZW5kZXJHcm91cHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAgICAgICByZXMuanNvbihyZXNwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDYXRhc3Ryb3BoZVwiLCBlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcy5zZW5kU3RhdHVzKDUwMCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBwb3J0ID0gODAwMDtcbiAgICBhcHAubGlzdGVuKHBvcnQsICgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFdlIGFyZSBsaXZlIG9uICR7cG9ydH1gKTtcbiAgICB9KTtcbn1cblxuLy8gVE9ETyBwYWdpbmF0aW9uXG4vLyBUT0RPIGdyb3Vwcy1wYWdpbmF0aW9uXG4vLyBUT0RPIGJhY2tmaWxsXG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwVmFsdWVPcmRlcihpdDogSXRlcmFibGVJdGVyYXRvcjxHcm91cFZhbHVlPikge1xuICAgIGxldCBpID0gMTtcbiAgICBBcnJheS5mcm9tKGl0KS5zb3J0KChhOiBHcm91cFZhbHVlLCBiOiBHcm91cFZhbHVlKSA9PiBhLm9yZGVyLWIub3JkZXIpLmZvckVhY2goKGc6IEdyb3VwVmFsdWUpID0+IHtcbiAgICAgICAgLy8gbm9ybWFsaXplIG9yZGVyIGJhc2VkIG9uIHNvcnQgYnkgZmxvYXRcbiAgICAgICAgZy5vcmRlciA9IGkrKztcbiAgICB9KTtcbn1cblxuY2xhc3MgRmlsdGVyIHtcbiAgICByb29tczogU2V0PHN0cmluZz47XG4gICAgbm90Um9vbXM6IFNldDxzdHJpbmc+O1xuICAgIHNlbmRlcnM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFNlbmRlcnM6IFNldDxzdHJpbmc+O1xuICAgIHR5cGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RUeXBlczogU2V0PHN0cmluZz47XG4gICAgbGltaXQ6IG51bWJlcjtcbiAgICBjb250YWluc1VSTDogYm9vbGVhbiB8IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0cnVjdG9yKG86IG9iamVjdCkge1xuICAgICAgICB0aGlzLnJvb21zID0gbmV3IFNldDxzdHJpbmc+KG9bJ3Jvb21zJ10pO1xuICAgICAgICB0aGlzLm5vdFJvb21zID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF9yb29tcyddKTtcbiAgICAgICAgdGhpcy5zZW5kZXJzID0gbmV3IFNldDxzdHJpbmc+KG9bJ3NlbmRlcnMnXSk7XG4gICAgICAgIHRoaXMubm90U2VuZGVycyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3Rfc2VuZGVycyddKTtcbiAgICAgICAgdGhpcy50eXBlcyA9IG5ldyBTZXQ8c3RyaW5nPihvWyd0eXBlcyddKTtcbiAgICAgICAgdGhpcy5ub3RUeXBlcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3RfdHlwZXMnXSk7XG5cbiAgICAgICAgdGhpcy5saW1pdCA9IHR5cGVvZiBvWydsaW1pdCddID09PSBcIm51bWJlclwiID8gb1snbGltaXQnXSA6IDEwO1xuICAgICAgICB0aGlzLmNvbnRhaW5zVVJMID0gb1snY29udGFpbnNfdXJsJ107XG4gICAgfVxufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEV2ZW50Q29udGV4dCB7XG4gICAgYmVmb3JlX2xpbWl0PzogbnVtYmVyO1xuICAgIGFmdGVyX2xpbWl0PzogbnVtYmVyO1xuICAgIGluY2x1ZGVfcHJvZmlsZTogYm9vbGVhbjtcbn1cblxuZW51bSBSZXF1ZXN0R3JvdXBLZXkge1xuICAgIHJvb21JZCA9IFwicm9vbV9pZFwiLFxuICAgIHNlbmRlciA9IFwic2VuZGVyXCIsXG59XG5cbmludGVyZmFjZSBSZXF1ZXN0R3JvdXAge1xuICAgIGtleTogUmVxdWVzdEdyb3VwS2V5O1xufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEdyb3VwcyB7XG4gICAgZ3JvdXBfYnk/OiBBcnJheTxSZXF1ZXN0R3JvdXA+O1xufVxuXG5lbnVtIFJlcXVlc3RLZXkge1xuICAgIGJvZHkgPSBcImNvbnRlbnQuYm9keVwiLFxuICAgIG5hbWUgPSBcImNvbnRlbnQubmFtZVwiLFxuICAgIHRvcGljID0gXCJjb250ZW50LnRvcGljXCIsXG59XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXF1ZXN0Qm9keSB7XG4gICAgc2VhcmNoX3Rlcm06IHN0cmluZztcbiAgICBrZXlzPzogQXJyYXk8UmVxdWVzdEtleT47XG4gICAgZmlsdGVyPzogb2JqZWN0OyAvLyB0aGlzIGdldHMgaW5mbGF0ZWQgdG8gYW4gaW5zdGFuY2Ugb2YgRmlsdGVyXG4gICAgb3JkZXJfYnk/OiBzdHJpbmc7XG4gICAgZXZlbnRfY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQ7XG4gICAgaW5jbHVkZVN0YXRlPzogYm9vbGVhbjtcbiAgICBncm91cGluZ3M/OiBSZXF1ZXN0R3JvdXBzO1xufVxuXG5pbnRlcmZhY2UgTWF0cml4U2VhcmNoUmVxdWVzdCB7XG4gICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgcm9vbV9ldmVudHM/OiBNYXRyaXhTZWFyY2hSZXF1ZXN0Qm9keTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXNwb25zZSB7XG4gICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgcm9vbV9ldmVudHM/OiB7XG4gICAgICAgICAgICBjb3VudDogbnVtYmVyO1xuICAgICAgICAgICAgcmVzdWx0czogQXJyYXk8UmVzdWx0PjtcbiAgICAgICAgICAgIGhpZ2hsaWdodHM6IFNldDxzdHJpbmc+O1xuICAgICAgICAgICAgc3RhdGU/OiBNYXA8c3RyaW5nLCBBcnJheTxFdmVudD4+O1xuICAgICAgICAgICAgZ3JvdXBzPzogTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+O1xuICAgICAgICAgICAgbmV4dF9iYXRjaD86IHN0cmluZztcbiAgICAgICAgfVxuICAgIH1cbn0iXX0=