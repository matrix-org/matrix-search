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
const matrix_js_sdk_1 = require("./typings/matrix-js-sdk");
const sqlite3_1 = __importDefault(require("sqlite3"));
const indexeddbjs = require('indexeddb-js');
const Queue = require('better-queue');
const SqliteStore = require('better-queue-sqlite');
const request = require('request-promise');
// process.on('unhandledRejection', (reason, p) => {
//     console.log("Unhandled at : Promise", p, "reason:", reason);
// console.log(reason.stack);
// });
const LocalStorageCryptoStore = require('matrix-js-sdk/lib/crypto/store/localStorage-crypto-store').default;
// import StubStore from 'matrix-js-sdk/src/store/stub.js';
// import * as LevelStore from './level-store';
// import * as Promise from 'bluebird';
// create directory which will house the 3 stores.
mkdirp.sync('./store');
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store/localStorage');
global.Olm = require('olm');
const matrix_js_sdk_2 = require("matrix-js-sdk");
const utils = require('matrix-js-sdk/src/utils');
const engine = new sqlite3_1.default.Database('./store/indexedb.sqlite');
const scope = indexeddbjs.makeScope('sqlite3', engine);
const indexedDB = scope.indexedDB;
if (indexedDB) {
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(indexedDB, 'matrix-js-sdk:crypto'));
    matrix_js_sdk_2.setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(null));
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
            body: events.map(ev => ev.event),
        });
    }
}
const b = new BleveHttp("http://localhost:9999/api/");
const q = new Queue((batch, cb) => {
    b.index(batch).then(cb);
}, {
    batchSize: 100,
    maxRetries: 10,
    retryDelay: 1000,
    store: new SqliteStore({
        path: './store/queue',
    }),
    filter: (event, cb) => {
        if (event.getType() !== 'm.room.message')
            return cb(null, event);
        return cb('not m.room.message');
    }
});
setup().then(console.log).catch(console.error);
function intersect(a, b) {
    return new Set([...a].filter(x => b.has(x)));
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
    filterRooms(roomIds) {
        let roomIdsSet = new Set(roomIds);
        if (this.notRooms)
            this.notRooms.forEach(notRoom => roomIdsSet.delete(notRoom));
        if (this.rooms)
            roomIdsSet = intersect(roomIdsSet, this.rooms);
        return roomIdsSet;
    }
}
class Result {
    constructor(event, rank) {
        this.event = event;
        this.rank = rank;
    }
}
class GroupValue {
    constructor() {
        this.order = undefined;
        this.nextBatch = "";
        this.results = [];
    }
    add(eventId, order) {
        if (this.order === undefined)
            this.order = order;
        this.results.push(eventId);
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
var QueryType;
(function (QueryType) {
    QueryType["Must"] = "must";
    QueryType["MustNot"] = "mustnot";
})(QueryType || (QueryType = {}));
class Query {
    constructor(fieldName, type, values) {
        this.fieldName = fieldName;
        this.type = type;
        this.values = Array.from(values);
    }
}
class BleveRequest {
    constructor(keys, filter, orderBy, searchTerm, from, size) {
        this.keys = keys;
        this.filter = filter;
        this.sortBy = orderBy;
        this.searchTerm = searchTerm;
        this.from = from;
        this.size = size;
    }
}
const pageSize = 10;
matrix_js_sdk_1.MatrixClient.prototype.fetchEvent = async function (roomId, eventId) {
    const path = utils.encodeUri('/rooms/$roomId/event/$eventId', {
        $roomId: roomId,
        $eventId: eventId,
    });
    let res;
    try {
        res = await this._http.authedRequest(undefined, 'GET', path);
    }
    catch (e) { }
    if (!res || !res.event)
        throw new Error("'event' not in '/event' result - homeserver too old?");
    return this.getEventMapper()(res.event);
};
// XXX: use getEventTimeline once we store rooms properly
matrix_js_sdk_1.MatrixClient.prototype.fetchEventContext = async function (roomId, eventId) {
    const path = utils.encodeUri('/rooms/$roomId/context/$eventId', {
        $roomId: roomId,
        $eventId: eventId,
    });
    let res;
    try {
        res = await this._http.authedRequest(undefined, 'GET', path);
    }
    catch (e) { }
    if (!res || !res.event)
        throw new Error("'event' not in '/event' result - homeserver too old?");
    const mapper = this.getEventMapper();
    const event = mapper(res.event);
    const state = utils.map(res.state, mapper);
    const events_after = utils.map(res.events_after, mapper);
    const events_before = utils.map(res.events_before, mapper);
    return {
        event,
        context: {
            state,
            events_after,
            events_before,
        },
    };
};
class Search {
    constructor(cli) {
        this.cli = cli;
    }
    async resolveOne(eventId, context) {
        //
    }
    // keep context as a map, so the whole thing can just be nulled.
    async resolve(eventIds, context) {
    }
    // keys: pass straight through to go-bleve
    // searchFilter: compute and send search rules to go-bleve
    // roomIDsSet: used with above /\
    // sortBy: pass straight through to go-bleve
    // searchTerm: pass straight through to go-bleve
    // from: pass straight through to go-bleve
    // context: branch on whether or not to fetch context/events (js-sdk only supports context at this time iirc)
    async query(keys, searchFilter, orderBy, searchTerm, from, context) {
        const queries = [];
        // must satisfy room_id
        if (searchFilter.rooms.size > 0)
            queries.push(new Query('room_id', QueryType.Must, searchFilter.rooms));
        // must satisfy !room_id
        if (searchFilter.notRooms.size > 0)
            queries.push(new Query('room_id', QueryType.MustNot, searchFilter.notRooms));
        // must satisfy sender
        if (searchFilter.senders.size > 0)
            queries.push(new Query('sender', QueryType.Must, searchFilter.senders));
        // must satisfy !sender
        if (searchFilter.notSenders.size > 0)
            queries.push(new Query('sender', QueryType.MustNot, searchFilter.notSenders));
        // must satisfy type
        if (searchFilter.types.size > 0)
            queries.push(new Query('type', QueryType.Must, searchFilter.types));
        // must satisfy !type
        if (searchFilter.notTypes.size > 0)
            queries.push(new Query('type', QueryType.MustNot, searchFilter.notTypes));
        const r = new BleveRequest(keys, queries, orderBy, searchTerm, from, pageSize);
        console.log(JSON.stringify(r));
        const resp = await b.search(r);
        console.log("DEBUG: ", resp);
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
        const loginClient = matrix_js_sdk_2.createClient({
            baseUrl: 'https://matrix.org',
        });
        try {
            const res = await loginClient.login('m.login.password', {
                user: '@webdevguru:matrix.org',
                password: '***REMOVED***',
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
    const cli = matrix_js_sdk_2.createClient(Object.assign({ baseUrl: 'https://matrix.org', idBaseUrl: '' }, creds, { useAuthorizationHeader: true, 
        // sessionStore: new LevelStore(),
        // store: new IndexedDBStore({
        //     indexedDB: indexedDB,
        //     dbName: 'matrix-search-sync',
        //     localStorage: global.localStorage,
        // }),
        store: new matrix_js_sdk_2.MatrixInMemoryStore({
            localStorage: global.localStorage,
        }), sessionStore: new matrix_js_sdk_2.WebStorageSessionStore(global.localStorage) }));
    cli.on('event', (event) => {
        if (event.isEncrypted())
            return;
        return q.push(event);
    });
    cli.on('Event.decrypted', (event) => {
        if (event.isDecryptionFailure()) {
            console.warn(event);
            return;
        }
        return q.push(event);
    });
    try {
        await cli.initCrypto();
    }
    catch (e) {
        console.log(e);
    }
    cli.startClient();
    // process.exit(1);
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
            const roomCat = req.body['search_categories']['room_events'];
            let keys = ['content.body', 'content.name', 'content.topic'];
            if ('keys' in roomCat && roomCat.keys.length)
                keys = roomCat.keys;
            const includeState = Boolean(roomCat['include_state']);
            const eventContext = roomCat['event_context'];
            let groupByRoomId = false;
            let groupBySender = false;
            if ('groupings' in roomCat) {
                roomCat.groupings.forEach(grouping => {
                    switch (grouping.key) {
                        case 'room_id':
                            groupByRoomId = true;
                            break;
                        case 'sender':
                            groupBySender = true;
                            break;
                    }
                });
            }
            let highlights = [];
            const searchFilter = new Filter(roomCat.filter);
            const joinedRooms = cli.getRooms();
            const roomIds = joinedRooms.map((room) => room.roomId);
            if (roomIds.length < 1) {
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
            let globalNextBatch = null;
            let count = 0;
            let allowedEvents = [];
            const eventMap = new Map();
            const rooms = new Set();
            const search = new Search(cli);
            const searchTerm = roomCat['search_term'];
            // TODO extend local event map using sqlite/leveldb
            switch (roomCat['order_by']) {
                case 'rank':
                case '':
                    // get messages from Bleve by rank // resolve them locally
                    search.query(keys, searchFilter, SearchOrder.Rank, searchTerm, 0, eventContext);
                    break;
                case 'recent':
                    const from = nextBatch !== null ? nextBatch.from() : 0;
                    search.query(keys, searchFilter, SearchOrder.Recent, searchTerm, from, eventContext);
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
            allowedEvents.forEach((evId) => {
                const res = eventMap[evId];
                const ev = res.event;
                if (groupByRoomId) {
                    let v = roomGroups.get(ev.getRoomId());
                    if (!v)
                        v = new GroupValue();
                    v.add(ev.getId(), res.order);
                    roomGroups.set(ev.getRoomId(), v);
                }
                if (groupBySender) {
                    let v = senderGroups.get(ev.getSender());
                    if (!v)
                        v = new GroupValue();
                    v.add(ev.getId(), res.order);
                    senderGroups.set(ev.getSender(), v);
                }
                rooms.add(ev.getRoomId());
            });
            // TODO highlights calculation must remain on bleve side
            const roomStateMap = new Map();
            if (includeState) {
                // TODO fetch state from server using API
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
            const results = allowedEvents.map((eventId) => eventMap[eventId].event);
            const resp = {
                search_categories: {
                    room_events: {
                        highlights: highlights,
                        nextBatch: globalNextBatch,
                        state: roomStateMap,
                        results,
                        count,
                    },
                },
            };
            if (groupByRoomId || groupBySender)
                resp.search_categories.room_events['groups'] = new Map();
            if (groupByRoomId)
                resp.search_categories.room_events['groups']['room_id'] = roomGroups;
            if (groupBySender)
                resp.search_categories.room_events['groups']['sender'] = senderGroups;
            res.json(resp);
        }
        catch (e) {
            console.log("Catastrophe", e);
        }
        console.log(req.body);
        res.sendStatus(200);
    });
    const port = 8000;
    app.listen(port, () => {
        console.log('We are live on ' + port);
    });
}
