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
// create directory which will house the 3 stores.
mkdirp.sync('./store');
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null)
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store/localStorage');
// import Olm before importing js-sdk to prevent it crying
global.Olm = require('olm');
const matrix_js_sdk_1 = require("matrix-js-sdk");
const utils = require('matrix-js-sdk/src/utils');
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
    console.log(batch);
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
        if (event.getType() !== 'm.room.message')
            return cb('not m.room.message');
        return cb(null, event.event);
    }
});
q.on('task_accepted', function (taskId, ev) {
    console.info(`Enqueue event ${ev.room_id}/${ev.event_id} ${ev.sender} [${ev.type}] (${taskId})`);
});
q.on('batch_failed', function (err) {
    console.error("[ERROR] Batch failed: ", err);
});
setup().then(console.log).catch(console.error);
Set.prototype.intersect = function (s) {
    return new Set([...this].filter(x => s.has(x)));
};
Set.prototype.union = function (s) {
    return new Set([...this, ...s]);
};
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
// "dumb" mapper because e2e should be decrypted in browser, so we don't lose verification status
function mapper(cli, plainOldJsObject) {
    return new matrix_js_sdk_1.MatrixEvent(plainOldJsObject);
}
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
    // const mapper = this.getEventMapper();
    const event = mapper(this, res.event);
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
    // impedance matching.
    async resolveOne(roomId, eventId, context) {
        if (context)
            return await this.cli.fetchEventContext(roomId, eventId);
        return {
            event: await this.cli.fetchEvent(roomId, eventId),
        };
    }
    // keep context as a map, so the whole thing can just be nulled.
    async resolve(rows, context) {
        return [];
    }
    // keys: pass straight through to go-bleve
    // searchFilter: compute and send search rules to go-bleve
    // roomIDsSet: used with above /\
    // sortBy: pass straight through to go-bleve
    // searchTerm: pass straight through to go-bleve
    // from: pass straight through to go-bleve
    // context: branch on whether or not to fetch context/events (js-sdk only supports context at this time iirc)
    async query(keys, searchFilter, sortBy, searchTerm, from, context) {
        const filter = {
            mustNot: new Map(),
            must: new Map(),
        };
        // must satisfy room_id
        if (searchFilter.rooms.size > 0)
            filter.must.set('room_id', [...searchFilter.rooms]);
        if (searchFilter.notRooms.size > 0)
            filter.mustNot.set('room_id', [...searchFilter.notRooms]);
        // must satisfy sender
        if (searchFilter.senders.size > 0)
            filter.must.set('sender', [...searchFilter.senders]);
        if (searchFilter.notSenders.size > 0)
            filter.mustNot.set('sender', [...searchFilter.notSenders]);
        // must satisfy type
        if (searchFilter.types.size > 0)
            filter.must.set('type', [...searchFilter.types]);
        if (searchFilter.notTypes.size > 0)
            filter.mustNot.set('type', [...searchFilter.notTypes]);
        const r = {
            from,
            keys,
            filter,
            sortBy,
            searchTerm,
            size: pageSize,
        };
        const resp = await b.search(r);
        return {
            rows: resp.rows,
            lookup: await this.resolve(resp.rows, context),
            total: resp.total,
        };
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
            const castBody = req.body;
            const roomCat = castBody.search_categories.room_events;
            let keys = ['content.body', 'content.name', 'content.topic']; // default vaue for roomCat.key
            if (roomCat.keys && roomCat.keys.length)
                keys = roomCat.keys;
            const includeState = Boolean(roomCat['include_state']);
            const eventContext = roomCat['event_context'];
            let groupByRoomId = false;
            let groupBySender = false;
            if (roomCat.groupings && roomCat.groupings.group_by) {
                roomCat.groupings.group_by.forEach(grouping => {
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
            const searchFilter = new Filter(roomCat.filter || {}); // default to empty object to assume defaults
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
            let result;
            // TODO extend local event map using sqlite/leveldb
            switch (roomCat['order_by']) {
                case 'rank':
                case '':
                    // get messages from Bleve by rank // resolve them locally
                    result = await search.query(keys, searchFilter, SearchOrder.Rank, searchTerm, 0, eventContext);
                    break;
                case 'recent':
                    const from = nextBatch !== null ? nextBatch.from() : 0;
                    result = await search.query(keys, searchFilter, SearchOrder.Recent, searchTerm, from, eventContext);
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
            // const highlightsSuperset = new Set<string>();
            // resp.rows.forEach((row: BleveResponseRow) => {
            //     row.highlights.forEach((highlight: string) => {
            //         highlightsSuperset.add(highlight);
            //     });
            // });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFRQSxnREFBd0I7QUFDeEIsc0RBQW1EO0FBQ25ELDhEQUFxQztBQUNyQywrQ0FBaUM7QUFHakMsaUNBQWlDO0FBRWpDLCtDQUErQztBQUMvQyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDdEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUM7QUFDbkQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFFM0MsTUFBTSx1QkFBdUIsR0FBRyxPQUFPLENBQUMsMERBQTBELENBQUMsQ0FBQyxPQUFPLENBQUM7QUFFNUcsa0RBQWtEO0FBQ2xELE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdkIsOEJBQThCO0FBQzlCLElBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsWUFBWSxLQUFLLElBQUk7SUFDMUUsTUFBTSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUVsRywwREFBMEQ7QUFDMUQsTUFBTSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFNUIsaURBYXVCO0FBRXZCLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0FBRWpELElBQUksU0FBUyxDQUFDO0FBRWQsa0VBQWtFO0FBQ2xFLDBEQUEwRDtBQUMxRCwrQkFBK0I7QUFFL0IsSUFBSSxTQUFTLEVBQUU7SUFDWCw0RkFBNEY7SUFDNUYsK0RBQStEO0NBQ2xFO0tBQU07SUFDSCxxQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLHVCQUF1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cUIsQ0FBQTtJQUNyQixxQ0FBdUIsQ0FBQTtBQUMzQixDQUFDLEVBSkksVUFBVSxLQUFWLFVBQVUsUUFJZCIsInNvdXJjZXNDb250ZW50IjpbImRlY2xhcmUgdmFyIGdsb2JhbDoge1xuICAgIE9sbTogYW55XG4gICAgbG9jYWxTdG9yYWdlPzogYW55XG4gICAgYXRvYjogKHN0cmluZykgPT4gc3RyaW5nO1xufTtcblxuLy8gaW1wb3J0ICogYXMgcmVxdWVzdCBmcm9tIFwicmVxdWVzdC1wcm9taXNlXCI7XG5pbXBvcnQge1JlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnN9IGZyb20gXCJyZXF1ZXN0LXByb21pc2VcIjtcbmltcG9ydCBjb3JzIGZyb20gJ2NvcnMnO1xuaW1wb3J0IGV4cHJlc3MsIHtSZXF1ZXN0LCBSZXNwb25zZX0gZnJvbSBcImV4cHJlc3NcIjtcbmltcG9ydCBib2R5UGFyc2VyIGZyb20gJ2JvZHktcGFyc2VyJztcbmltcG9ydCAqIGFzIG1rZGlycCBmcm9tIFwibWtkaXJwXCI7XG5cbmltcG9ydCB7UmVxdWVzdEFQSSwgUmVxdWlyZWRVcmlVcmx9IGZyb20gXCJyZXF1ZXN0XCI7XG4vLyBpbXBvcnQgc3FsaXRlMyBmcm9tICdzcWxpdGUzJztcblxuLy8gY29uc3QgaW5kZXhlZGRianMgPSByZXF1aXJlKCdpbmRleGVkZGItanMnKTtcbmNvbnN0IFF1ZXVlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlJyk7XG5jb25zdCBTcWxpdGVTdG9yZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZS1zcWxpdGUnKTtcbmNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0LXByb21pc2UnKTtcblxuY29uc3QgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL2xpYi9jcnlwdG8vc3RvcmUvbG9jYWxTdG9yYWdlLWNyeXB0by1zdG9yZScpLmRlZmF1bHQ7XG5cbi8vIGNyZWF0ZSBkaXJlY3Rvcnkgd2hpY2ggd2lsbCBob3VzZSB0aGUgMyBzdG9yZXMuXG5ta2RpcnAuc3luYygnLi9zdG9yZScpO1xuLy8gTG9hZGluZyBsb2NhbFN0b3JhZ2UgbW9kdWxlXG5pZiAodHlwZW9mIGdsb2JhbC5sb2NhbFN0b3JhZ2UgPT09IFwidW5kZWZpbmVkXCIgfHwgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9PT0gbnVsbClcbiAgICBnbG9iYWwubG9jYWxTdG9yYWdlID0gbmV3IChyZXF1aXJlKCdub2RlLWxvY2Fsc3RvcmFnZScpLkxvY2FsU3RvcmFnZSkoJy4vc3RvcmUvbG9jYWxTdG9yYWdlJyk7XG5cbi8vIGltcG9ydCBPbG0gYmVmb3JlIGltcG9ydGluZyBqcy1zZGsgdG8gcHJldmVudCBpdCBjcnlpbmdcbmdsb2JhbC5PbG0gPSByZXF1aXJlKCdvbG0nKTtcblxuaW1wb3J0IHtcbiAgICBSb29tLFxuICAgIEV2ZW50LFxuICAgIE1hdHJpeCxcbiAgICBNYXRyaXhFdmVudCxcbiAgICBjcmVhdGVDbGllbnQsXG4gICAgTWF0cml4Q2xpZW50LFxuICAgIEluZGV4ZWREQlN0b3JlLFxuICAgIEV2ZW50V2l0aENvbnRleHQsXG4gICAgTWF0cml4SW5NZW1vcnlTdG9yZSxcbiAgICBJbmRleGVkREJDcnlwdG9TdG9yZSxcbiAgICBzZXRDcnlwdG9TdG9yZUZhY3RvcnksXG4gICAgV2ViU3RvcmFnZVNlc3Npb25TdG9yZSxcbn0gZnJvbSAnbWF0cml4LWpzLXNkayc7XG5cbmNvbnN0IHV0aWxzID0gcmVxdWlyZSgnbWF0cml4LWpzLXNkay9zcmMvdXRpbHMnKTtcblxubGV0IGluZGV4ZWREQjtcblxuLy8gY29uc3QgZW5naW5lID0gbmV3IHNxbGl0ZTMuRGF0YWJhc2UoJy4vc3RvcmUvaW5kZXhlZGIuc3FsaXRlJyk7XG4vLyBjb25zdCBzY29wZSA9IGluZGV4ZWRkYmpzLm1ha2VTY29wZSgnc3FsaXRlMycsIGVuZ2luZSk7XG4vLyBpbmRleGVkREIgPSBzY29wZS5pbmRleGVkREI7XG5cbmlmIChpbmRleGVkREIpIHtcbiAgICAvLyBzZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IEluZGV4ZWREQkNyeXB0b1N0b3JlKGluZGV4ZWREQiwgJ21hdHJpeC1qcy1zZGs6Y3J5cHRvJykpO1xuICAgIC8vIHNldENyeXB0b1N0b3JlRmFjdG9yeSgoKSA9PiBuZXcgSW5kZXhlZERCQ3J5cHRvU3RvcmUobnVsbCkpO1xufSBlbHNlIHtcbiAgICBzZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IExvY2FsU3RvcmFnZUNyeXB0b1N0b3JlKGdsb2JhbC5sb2NhbFN0b3JhZ2UpKTtcbn1cblxuXG5jbGFzcyBCbGV2ZUh0dHAge1xuICAgIHJlcXVlc3Q6IFJlcXVlc3RBUEk8UmVxdWVzdFByb21pc2UsIFJlcXVlc3RQcm9taXNlT3B0aW9ucywgUmVxdWlyZWRVcmlVcmw+O1xuXG4gICAgY29uc3RydWN0b3IoYmFzZVVybDogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMucmVxdWVzdCA9IHJlcXVlc3QuZGVmYXVsdHMoe1xuICAgICAgICAgICAgYmFzZVVybCxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2VhcmNoKHJlcTogQmxldmVSZXF1ZXN0KXtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdxdWVyeScsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGpzb246IHRydWUsXG4gICAgICAgICAgICBib2R5OiByZXEsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGluZGV4KGV2ZW50czogRXZlbnRbXSkge1xuICAgICAgICByZXR1cm4gdGhpcy5yZXF1ZXN0KHtcbiAgICAgICAgICAgIHVybDogJ2luZGV4JyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogZXZlbnRzLFxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmNvbnN0IGIgPSBuZXcgQmxldmVIdHRwKFwiaHR0cDovL2xvY2FsaG9zdDo5OTk5L2FwaS9cIik7XG5cbmNvbnN0IHEgPSBuZXcgUXVldWUoYXN5bmMgKGJhdGNoOiBFdmVudFtdLCBjYikgPT4ge1xuICAgIGNvbnNvbGUubG9nKGJhdGNoKTtcbiAgICB0cnkge1xuICAgICAgICBjYihudWxsLCBhd2FpdCBiLmluZGV4KGJhdGNoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYihlKTtcbiAgICB9XG59LCB7XG4gICAgYmF0Y2hTaXplOiAxMDAsXG4gICAgbWF4UmV0cmllczogMTAsXG4gICAgcmV0cnlEZWxheTogMTAwMCxcbiAgICBzdG9yZTogbmV3IFNxbGl0ZVN0b3JlKHtcbiAgICAgICAgcGF0aDogJy4vc3RvcmUvcXVldWUuc3FsaXRlJyxcbiAgICB9KSxcbiAgICBmaWx0ZXI6IChldmVudDogTWF0cml4RXZlbnQsIGNiKSA9PiB7XG4gICAgICAgIGlmIChldmVudC5nZXRUeXBlKCkgIT09ICdtLnJvb20ubWVzc2FnZScpIHJldHVybiBjYignbm90IG0ucm9vbS5tZXNzYWdlJyk7XG4gICAgICAgIHJldHVybiBjYihudWxsLCBldmVudC5ldmVudCk7XG4gICAgfVxufSk7XG5cbnEub24oJ3Rhc2tfYWNjZXB0ZWQnLCBmdW5jdGlvbih0YXNrSWQ6IHN0cmluZywgZXY6IEV2ZW50KSB7XG4gICAgY29uc29sZS5pbmZvKGBFbnF1ZXVlIGV2ZW50ICR7ZXYucm9vbV9pZH0vJHtldi5ldmVudF9pZH0gJHtldi5zZW5kZXJ9IFske2V2LnR5cGV9XSAoJHt0YXNrSWR9KWApO1xufSk7XG5cbnEub24oJ2JhdGNoX2ZhaWxlZCcsIGZ1bmN0aW9uKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbRVJST1JdIEJhdGNoIGZhaWxlZDogXCIsIGVycik7XG59KTtcblxuc2V0dXAoKS50aGVuKGNvbnNvbGUubG9nKS5jYXRjaChjb25zb2xlLmVycm9yKTtcblxuZGVjbGFyZSBnbG9iYWwge1xuICAgIGludGVyZmFjZSBTZXQ8VD4ge1xuICAgICAgICBpbnRlcnNlY3Q8VD4oczogU2V0PFQ+KTogU2V0PFQ+O1xuICAgICAgICB1bmlvbjxUPihzOiBTZXQ8VD4pOiBTZXQ8VD47XG4gICAgfVxufVxuXG5TZXQucHJvdG90eXBlLmludGVyc2VjdCA9IGZ1bmN0aW9uPFQ+KHM6IFNldDxUPik6IFNldDxUPiB7XG4gICAgcmV0dXJuIG5ldyBTZXQ8VD4oWy4uLnRoaXNdLmZpbHRlcih4ID0+IHMuaGFzKHgpKSk7XG59O1xuU2V0LnByb3RvdHlwZS51bmlvbiA9IGZ1bmN0aW9uPFQ+KHM6IFNldDxUPik6IFNldDxUPiB7XG4gICAgcmV0dXJuIG5ldyBTZXQ8VD4oWy4uLnRoaXMsIC4uLnNdKTtcbn07XG5cbmNsYXNzIEdyb3VwVmFsdWUge1xuICAgIHB1YmxpYyBvcmRlcjogbnVtYmVyfHVuZGVmaW5lZDtcbiAgICBwdWJsaWMgbmV4dEJhdGNoOiBzdHJpbmc7XG4gICAgcHVibGljIHJlc3VsdHM6IEFycmF5PHN0cmluZz47XG5cbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgdGhpcy5vcmRlciA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5uZXh0QmF0Y2ggPSBcIlwiO1xuICAgICAgICB0aGlzLnJlc3VsdHMgPSBbXTtcbiAgICB9XG5cbiAgICBhZGQoZXZlbnRJZDogc3RyaW5nLCBvcmRlcjogbnVtYmVyKSB7XG4gICAgICAgIGlmICh0aGlzLm9yZGVyID09PSB1bmRlZmluZWQpIHRoaXMub3JkZXIgPSBvcmRlcjtcbiAgICAgICAgdGhpcy5yZXN1bHRzLnB1c2goZXZlbnRJZCk7XG4gICAgfVxufVxuXG5jbGFzcyBCYXRjaCB7XG4gICAgcHVibGljIFRva2VuOiBudW1iZXI7XG4gICAgcHVibGljIEdyb3VwOiBzdHJpbmc7XG4gICAgcHVibGljIEdyb3VwS2V5OiBzdHJpbmc7XG5cbiAgICBjb25zdHJ1Y3RvcihUb2tlbjogbnVtYmVyID0gMCwgR3JvdXA6IHN0cmluZywgR3JvdXBLZXk6IHN0cmluZykge1xuICAgICAgICB0aGlzLlRva2VuID0gVG9rZW47XG4gICAgICAgIHRoaXMuR3JvdXAgPSBHcm91cDtcbiAgICAgICAgdGhpcy5Hcm91cEtleSA9IEdyb3VwS2V5O1xuICAgIH1cblxuICAgIHN0YXRpYyBmcm9tU3RyaW5nKGZyb206IHN0cmluZyk6IEJhdGNoIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG8gPSBKU09OLnBhcnNlKGZyb20pO1xuICAgICAgICAgICAgLy8gY29uc3QgYiA9IG5ldyBCYXRjaChvKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZyb20oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLlRva2VuO1xuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgVG9rZW46IHRoaXMuVG9rZW4sXG4gICAgICAgICAgICBHcm91cDogdGhpcy5Hcm91cCxcbiAgICAgICAgICAgIEdyb3VwS2V5OiB0aGlzLkdyb3VwS2V5LFxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBRdWVyeSB7XG4gICAgbXVzdDogTWFwPHN0cmluZywgQXJyYXk8c3RyaW5nPj47XG4gICAgbXVzdE5vdDogTWFwPHN0cmluZywgQXJyYXk8c3RyaW5nPj47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlcXVlc3Qge1xuICAgIGtleXM6IEFycmF5PHN0cmluZz47XG4gICAgZmlsdGVyOiBRdWVyeTtcbiAgICBzb3J0Qnk6IFNlYXJjaE9yZGVyO1xuICAgIHNlYXJjaFRlcm06IHN0cmluZztcbiAgICBmcm9tOiBudW1iZXI7XG4gICAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBwYWdlU2l6ZSA9IDEwO1xuXG5pbnRlcmZhY2UgQmxldmVSZXNwb25zZVJvdyB7XG4gICAgcm9vbUlkOiBzdHJpbmc7XG4gICAgZXZlbnRJZDogc3RyaW5nO1xuICAgIHNjb3JlOiBudW1iZXI7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlIHtcbiAgICByb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PjtcbiAgICB0b3RhbDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXZlbnRMb29rdXBDb250ZXh0IHtcbiAgICBzdGFydDogc3RyaW5nO1xuICAgIGVuZDogc3RyaW5nO1xuICAgIGV2ZW50c0JlZm9yZTogQXJyYXk8TWF0cml4RXZlbnQ+O1xuICAgIGV2ZW50c0FmdGVyOiBBcnJheTxNYXRyaXhFdmVudD47XG4gICAgc3RhdGU6IEFycmF5PE1hdHJpeEV2ZW50Pjtcbn1cblxuaW50ZXJmYWNlIEV2ZW50TG9va3VwUmVzdWx0IHtcbiAgICBldmVudDogTWF0cml4RXZlbnQ7XG4gICAgc2NvcmU6IG51bWJlcjtcbiAgICBjb250ZXh0OiBFdmVudExvb2t1cENvbnRleHQgfCBudWxsO1xuICAgIGhpZ2hsaWdodHM6IFNldDxzdHJpbmc+O1xufVxuXG5pbnRlcmZhY2UgUmVzdWx0IHtcbiAgICByb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PjtcbiAgICBsb29rdXA6IEFycmF5PEV2ZW50TG9va3VwUmVzdWx0PjtcbiAgICB0b3RhbDogbnVtYmVyO1xufVxuXG5NYXRyaXhDbGllbnQucHJvdG90eXBlLmZldGNoRXZlbnQgPSBhc3luYyBmdW5jdGlvbihyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRyaXhFdmVudD4ge1xuICAgIGNvbnN0IHBhdGggPSB1dGlscy5lbmNvZGVVcmkoJy9yb29tcy8kcm9vbUlkL2V2ZW50LyRldmVudElkJywge1xuICAgICAgICAkcm9vbUlkOiByb29tSWQsXG4gICAgICAgICRldmVudElkOiBldmVudElkLFxuICAgIH0pO1xuXG4gICAgbGV0IHJlcztcbiAgICB0cnkge1xuICAgICAgICByZXMgPSBhd2FpdCB0aGlzLl9odHRwLmF1dGhlZFJlcXVlc3QodW5kZWZpbmVkLCAnR0VUJywgcGF0aCk7XG4gICAgfSBjYXRjaCAoZSkge31cblxuICAgIGlmICghcmVzIHx8ICFyZXMuZXZlbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIidldmVudCcgbm90IGluICcvZXZlbnQnIHJlc3VsdCAtIGhvbWVzZXJ2ZXIgdG9vIG9sZD9cIik7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRFdmVudE1hcHBlcigpKHJlcy5ldmVudCk7XG59O1xuXG4vLyBcImR1bWJcIiBtYXBwZXIgYmVjYXVzZSBlMmUgc2hvdWxkIGJlIGRlY3J5cHRlZCBpbiBicm93c2VyLCBzbyB3ZSBkb24ndCBsb3NlIHZlcmlmaWNhdGlvbiBzdGF0dXNcbmZ1bmN0aW9uIG1hcHBlcihjbGk6IE1hdHJpeENsaWVudCwgcGxhaW5PbGRKc09iamVjdDogRXZlbnQpOiBNYXRyaXhFdmVudCB7XG4gICAgcmV0dXJuIG5ldyBNYXRyaXhFdmVudChwbGFpbk9sZEpzT2JqZWN0KTtcbn1cblxuLy8gWFhYOiB1c2UgZ2V0RXZlbnRUaW1lbGluZSBvbmNlIHdlIHN0b3JlIHJvb21zIHByb3Blcmx5XG5NYXRyaXhDbGllbnQucHJvdG90eXBlLmZldGNoRXZlbnRDb250ZXh0ID0gYXN5bmMgZnVuY3Rpb24ocm9vbUlkOiBzdHJpbmcsIGV2ZW50SWQ6IHN0cmluZyk6IFByb21pc2U8RXZlbnRXaXRoQ29udGV4dD4ge1xuICAgIGNvbnN0IHBhdGggPSB1dGlscy5lbmNvZGVVcmkoJy9yb29tcy8kcm9vbUlkL2NvbnRleHQvJGV2ZW50SWQnLCB7XG4gICAgICAgICRyb29tSWQ6IHJvb21JZCxcbiAgICAgICAgJGV2ZW50SWQ6IGV2ZW50SWQsXG4gICAgfSk7XG5cbiAgICBsZXQgcmVzO1xuICAgIHRyeSB7XG4gICAgICAgIHJlcyA9IGF3YWl0IHRoaXMuX2h0dHAuYXV0aGVkUmVxdWVzdCh1bmRlZmluZWQsICdHRVQnLCBwYXRoKTtcbiAgICB9IGNhdGNoIChlKSB7fVxuXG4gICAgaWYgKCFyZXMgfHwgIXJlcy5ldmVudClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiJ2V2ZW50JyBub3QgaW4gJy9ldmVudCcgcmVzdWx0IC0gaG9tZXNlcnZlciB0b28gb2xkP1wiKTtcblxuICAgIC8vIGNvbnN0IG1hcHBlciA9IHRoaXMuZ2V0RXZlbnRNYXBwZXIoKTtcblxuICAgIGNvbnN0IGV2ZW50ID0gbWFwcGVyKHRoaXMsIHJlcy5ldmVudCk7XG5cbiAgICBjb25zdCBzdGF0ZSA9IHV0aWxzLm1hcChyZXMuc3RhdGUsIG1hcHBlcik7XG4gICAgY29uc3QgZXZlbnRzX2FmdGVyID0gdXRpbHMubWFwKHJlcy5ldmVudHNfYWZ0ZXIsIG1hcHBlcik7XG4gICAgY29uc3QgZXZlbnRzX2JlZm9yZSA9IHV0aWxzLm1hcChyZXMuZXZlbnRzX2JlZm9yZSwgbWFwcGVyKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGV2ZW50LFxuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBzdGF0ZSxcbiAgICAgICAgICAgIGV2ZW50c19hZnRlcixcbiAgICAgICAgICAgIGV2ZW50c19iZWZvcmUsXG4gICAgICAgIH0sXG4gICAgfTtcbn07XG5cbmNsYXNzIFNlYXJjaCB7XG4gICAgY2xpOiBNYXRyaXhDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcihjbGk6IE1hdHJpeENsaWVudCkge1xuICAgICAgICB0aGlzLmNsaSA9IGNsaTtcbiAgICB9XG5cbiAgICAvLyBpbXBlZGFuY2UgbWF0Y2hpbmcuXG4gICAgYXN5bmMgcmVzb2x2ZU9uZShyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nLCBjb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dCk6IFByb21pc2U8RXZlbnRXaXRoQ29udGV4dD4ge1xuICAgICAgICBpZiAoY29udGV4dClcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaS5mZXRjaEV2ZW50Q29udGV4dChyb29tSWQsIGV2ZW50SWQpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBldmVudDogYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudChyb29tSWQsIGV2ZW50SWQpLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIGtlZXAgY29udGV4dCBhcyBhIG1hcCwgc28gdGhlIHdob2xlIHRoaW5nIGNhbiBqdXN0IGJlIG51bGxlZC5cbiAgICBhc3luYyByZXNvbHZlKHJvd3M6IEFycmF5PEJsZXZlUmVzcG9uc2VSb3c+LCBjb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dCk6IFByb21pc2U8QXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+PiB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyBrZXlzOiBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAvLyBzZWFyY2hGaWx0ZXI6IGNvbXB1dGUgYW5kIHNlbmQgc2VhcmNoIHJ1bGVzIHRvIGdvLWJsZXZlXG4gICAgLy8gcm9vbUlEc1NldDogdXNlZCB3aXRoIGFib3ZlIC9cXFxuICAgIC8vIHNvcnRCeTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gc2VhcmNoVGVybTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gZnJvbTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gY29udGV4dDogYnJhbmNoIG9uIHdoZXRoZXIgb3Igbm90IHRvIGZldGNoIGNvbnRleHQvZXZlbnRzIChqcy1zZGsgb25seSBzdXBwb3J0cyBjb250ZXh0IGF0IHRoaXMgdGltZSBpaXJjKVxuICAgIGFzeW5jIHF1ZXJ5KGtleXM6IEFycmF5PHN0cmluZz4sIHNlYXJjaEZpbHRlcjogRmlsdGVyLCBzb3J0Qnk6IFNlYXJjaE9yZGVyLCBzZWFyY2hUZXJtOiBzdHJpbmcsIGZyb206IG51bWJlciwgY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQpOiBQcm9taXNlPFJlc3VsdD4ge1xuICAgICAgICBjb25zdCBmaWx0ZXI6IFF1ZXJ5ID0ge1xuICAgICAgICAgICAgbXVzdE5vdDogbmV3IE1hcCgpLFxuICAgICAgICAgICAgbXVzdDogbmV3IE1hcCgpLFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIG11c3Qgc2F0aXNmeSByb29tX2lkXG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIucm9vbXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3Jvb21faWQnLCBbLi4uc2VhcmNoRmlsdGVyLnJvb21zXSk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90Um9vbXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3Jvb21faWQnLCBbLi4uc2VhcmNoRmlsdGVyLm5vdFJvb21zXSk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHNlbmRlclxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3NlbmRlcicsIFsuLi5zZWFyY2hGaWx0ZXIuc2VuZGVyc10pO1xuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLm5vdFNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3NlbmRlcicsIFsuLi5zZWFyY2hGaWx0ZXIubm90U2VuZGVyc10pO1xuXG4gICAgICAgIC8vIG11c3Qgc2F0aXNmeSB0eXBlXG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIudHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3R5cGUnLCBbLi4uc2VhcmNoRmlsdGVyLnR5cGVzXSk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90VHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3R5cGUnLCBbLi4uc2VhcmNoRmlsdGVyLm5vdFR5cGVzXSk7XG5cbiAgICAgICAgY29uc3QgcjogQmxldmVSZXF1ZXN0ID0ge1xuICAgICAgICAgICAgZnJvbSxcbiAgICAgICAgICAgIGtleXMsXG4gICAgICAgICAgICBmaWx0ZXIsXG4gICAgICAgICAgICBzb3J0QnksXG4gICAgICAgICAgICBzZWFyY2hUZXJtLFxuICAgICAgICAgICAgc2l6ZTogcGFnZVNpemUsXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzcDogQmxldmVSZXNwb25zZSA9IGF3YWl0IGIuc2VhcmNoKHIpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcm93czogcmVzcC5yb3dzLFxuICAgICAgICAgICAgbG9va3VwOiBhd2FpdCB0aGlzLnJlc29sdmUocmVzcC5yb3dzLCBjb250ZXh0KSxcbiAgICAgICAgICAgIHRvdGFsOiByZXNwLnRvdGFsLFxuICAgICAgICB9O1xuICAgIH1cbn1cblxuZW51bSBTZWFyY2hPcmRlciB7XG4gICAgUmFuayA9ICdyYW5rJyxcbiAgICBSZWNlbnQgPSAncmVjZW50Jyxcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2V0dXAoKSB7XG4gICAgbGV0IGNyZWRzID0ge1xuICAgICAgICB1c2VySWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgndXNlcklkJyksXG4gICAgICAgIGRldmljZUlkOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2RldmljZUlkJyksXG4gICAgICAgIGFjY2Vzc1Rva2VuOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2FjY2Vzc1Rva2VuJyksXG4gICAgfTtcblxuICAgIGlmICghY3JlZHMudXNlcklkIHx8ICFjcmVkcy5kZXZpY2VJZCB8fCAhY3JlZHMuYWNjZXNzVG9rZW4pIHtcbiAgICAgICAgY29uc3QgbG9naW5DbGllbnQgPSBjcmVhdGVDbGllbnQoe1xuICAgICAgICAgICAgYmFzZVVybDogJ2h0dHBzOi8vbWF0cml4Lm9yZycsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXMgPSBhd2FpdCBsb2dpbkNsaWVudC5sb2dpbignbS5sb2dpbi5wYXNzd29yZCcsIHtcbiAgICAgICAgICAgICAgICB1c2VyOiAnQHdlYmRldmd1cnU6bWF0cml4Lm9yZycsXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQ6ICd0bEQkQDVaQ1VXNDFZI0hnJyxcbiAgICAgICAgICAgICAgICBpbml0aWFsX2RldmljZV9kaXNwbGF5X25hbWU6ICdNYXRyaXggU2VhcmNoIERhZW1vbicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0xvZ2dlZCBpbiBhcyAnICsgcmVzLnVzZXJfaWQpO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCd1c2VySWQnLCByZXMudXNlcl9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2RldmljZUlkJywgcmVzLmRldmljZV9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2FjY2Vzc1Rva2VuJywgcmVzLmFjY2Vzc190b2tlbik7XG5cbiAgICAgICAgICAgIGNyZWRzID0ge1xuICAgICAgICAgICAgICAgIHVzZXJJZDogcmVzLnVzZXJfaWQsXG4gICAgICAgICAgICAgICAgZGV2aWNlSWQ6IHJlcy5kZXZpY2VfaWQsXG4gICAgICAgICAgICAgICAgYWNjZXNzVG9rZW46IHJlcy5hY2Nlc3NfdG9rZW4sXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbiBlcnJvciBvY2N1cmVkIGxvZ2dpbmcgaW4hJyk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhlcnIpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY2xpID0gY3JlYXRlQ2xpZW50KHtcbiAgICAgICAgYmFzZVVybDogJ2h0dHBzOi8vbWF0cml4Lm9yZycsXG4gICAgICAgIGlkQmFzZVVybDogJycsXG4gICAgICAgIC4uLmNyZWRzLFxuICAgICAgICB1c2VBdXRob3JpemF0aW9uSGVhZGVyOiB0cnVlLFxuICAgICAgICAvLyBzZXNzaW9uU3RvcmU6IG5ldyBMZXZlbFN0b3JlKCksXG4gICAgICAgIC8vIHN0b3JlOiBuZXcgSW5kZXhlZERCU3RvcmUoe1xuICAgICAgICAvLyAgICAgaW5kZXhlZERCOiBpbmRleGVkREIsXG4gICAgICAgIC8vICAgICBkYk5hbWU6ICdtYXRyaXgtc2VhcmNoLXN5bmMnLFxuICAgICAgICAvLyAgICAgbG9jYWxTdG9yYWdlOiBnbG9iYWwubG9jYWxTdG9yYWdlLFxuICAgICAgICAvLyB9KSxcbiAgICAgICAgc3RvcmU6IG5ldyBNYXRyaXhJbk1lbW9yeVN0b3JlKHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZTogZ2xvYmFsLmxvY2FsU3RvcmFnZSxcbiAgICAgICAgfSksXG4gICAgICAgIHNlc3Npb25TdG9yZTogbmV3IFdlYlN0b3JhZ2VTZXNzaW9uU3RvcmUoZ2xvYmFsLmxvY2FsU3RvcmFnZSksXG4gICAgfSk7XG5cbiAgICBjbGkub24oJ2V2ZW50JywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuaXNFbmNyeXB0ZWQoKSkgcmV0dXJuO1xuICAgICAgICByZXR1cm4gcS5wdXNoKGV2ZW50KTtcbiAgICB9KTtcbiAgICBjbGkub24oJ0V2ZW50LmRlY3J5cHRlZCcsIChldmVudDogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmlzRGVjcnlwdGlvbkZhaWx1cmUoKSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGV2ZW50KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcS5wdXNoKGV2ZW50KTtcbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNsaS5pbml0Q3J5cHRvKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmxvZyhlKTtcbiAgICB9XG4gICAgY2xpLnN0YXJ0Q2xpZW50KCk7XG4gICAgLy8gcHJvY2Vzcy5leGl0KDEpO1xuXG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGFwcC51c2UoYm9keVBhcnNlci5qc29uKCkpO1xuICAgIGFwcC51c2UoY29ycyh7XG4gICAgICAgICdhbGxvd2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJywgJ0NvbnRlbnQtVHlwZSddLFxuICAgICAgICAnZXhwb3NlZEhlYWRlcnMnOiBbJ2FjY2Vzc190b2tlbiddLFxuICAgICAgICAnb3JpZ2luJzogJyonLFxuICAgICAgICAnbWV0aG9kcyc6ICdQT1NUJyxcbiAgICAgICAgJ3ByZWZsaWdodENvbnRpbnVlJzogZmFsc2VcbiAgICB9KSk7XG5cbiAgICBhcHAucG9zdCgnL3NlYXJjaCcsIGFzeW5jIChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFyZXEuYm9keSkge1xuICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNDAwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBuZXh0QmF0Y2g6IEJhdGNoIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGlmIChyZXEucXVlcnlbJ25leHRfYmF0Y2gnXSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBuZXh0QmF0Y2ggPSBKU09OLnBhcnNlKGdsb2JhbC5hdG9iKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKFwiRm91bmQgbmV4dCBiYXRjaCBvZlwiLCBuZXh0QmF0Y2gpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gcGFyc2UgbmV4dF9iYXRjaCBhcmd1bWVudFwiLCBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZlcmlmeSB0aGF0IHVzZXIgaXMgYWxsb3dlZCB0byBhY2Nlc3MgdGhpcyB0aGluZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY2FzdEJvZHk6IE1hdHJpeFNlYXJjaFJlcXVlc3QgPSByZXEuYm9keTtcbiAgICAgICAgICAgIGNvbnN0IHJvb21DYXQgPSBjYXN0Qm9keS5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cztcblxuICAgICAgICAgICAgbGV0IGtleXMgPSBbJ2NvbnRlbnQuYm9keScsICdjb250ZW50Lm5hbWUnLCAnY29udGVudC50b3BpYyddOyAvLyBkZWZhdWx0IHZhdWUgZm9yIHJvb21DYXQua2V5XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5rZXlzICYmIHJvb21DYXQua2V5cy5sZW5ndGgpIGtleXMgPSByb29tQ2F0LmtleXM7XG5cbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGVTdGF0ZSA9IEJvb2xlYW4ocm9vbUNhdFsnaW5jbHVkZV9zdGF0ZSddKTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50Q29udGV4dCA9IHJvb21DYXRbJ2V2ZW50X2NvbnRleHQnXTtcblxuICAgICAgICAgICAgbGV0IGdyb3VwQnlSb29tSWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxldCBncm91cEJ5U2VuZGVyID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5ncm91cGluZ3MgJiYgcm9vbUNhdC5ncm91cGluZ3MuZ3JvdXBfYnkpIHtcbiAgICAgICAgICAgICAgICByb29tQ2F0Lmdyb3VwaW5ncy5ncm91cF9ieS5mb3JFYWNoKGdyb3VwaW5nID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChncm91cGluZy5rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ3Jvb21faWQnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQnlSb29tSWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnc2VuZGVyJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5U2VuZGVyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgaGlnaGxpZ2h0czogQXJyYXk8c3RyaW5nPiA9IFtdO1xuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXIgPSBuZXcgRmlsdGVyKHJvb21DYXQuZmlsdGVyIHx8IHt9KTsgLy8gZGVmYXVsdCB0byBlbXB0eSBvYmplY3QgdG8gYXNzdW1lIGRlZmF1bHRzXG5cbiAgICAgICAgICAgIGNvbnN0IGpvaW5lZFJvb21zID0gY2xpLmdldFJvb21zKCk7XG4gICAgICAgICAgICBjb25zdCByb29tSWRzID0gam9pbmVkUm9vbXMubWFwKChyb29tOiBSb29tKSA9PiByb29tLnJvb21JZCk7XG5cbiAgICAgICAgICAgIGlmIChyb29tSWRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNLSVAgZm9yIG5vd1xuICAgICAgICAgICAgLy8gbGV0IHJvb21JZHNTZXQgPSBzZWFyY2hGaWx0ZXIuZmlsdGVyUm9vbXMocm9vbUlkcyk7XG5cbiAgICAgICAgICAgIC8vIGlmIChiLmlzR3JvdXBpbmcoXCJyb29tX2lkXCIpKSB7XG4gICAgICAgICAgICAvLyAgICAgcm9vbUlEc1NldC5JbnRlcnNlY3QoY29tbW9uLk5ld1N0cmluZ1NldChbXXN0cmluZ3sqYi5Hcm91cEtleX0pKVxuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICAvLyBUT0RPIGRvIHdlIG5lZWQgdGhpc1xuICAgICAgICAgICAgLy9yYW5rTWFwIDo9IG1hcFtzdHJpbmddZmxvYXQ2NHt9XG4gICAgICAgICAgICAvL2FsbG93ZWRFdmVudHMgOj0gW10qUmVzdWx0e31cbiAgICAgICAgICAgIC8vIFRPRE8gdGhlc2UgbmVlZCBjaGFuZ2luZ1xuICAgICAgICAgICAgY29uc3Qgcm9vbUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuICAgICAgICAgICAgY29uc3Qgc2VuZGVyR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEdyb3VwVmFsdWU+KCk7XG5cbiAgICAgICAgICAgIGxldCBnbG9iYWxOZXh0QmF0Y2g6IHN0cmluZ3xudWxsID0gbnVsbDtcbiAgICAgICAgICAgIGxldCBjb3VudDogbnVtYmVyID0gMDtcblxuICAgICAgICAgICAgbGV0IGFsbG93ZWRFdmVudHM6IEFycmF5PHN0cmluZz4gPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50TWFwID0gbmV3IE1hcDxzdHJpbmcsIFJlc3VsdD4oKTtcblxuICAgICAgICAgICAgY29uc3Qgcm9vbXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoID0gbmV3IFNlYXJjaChjbGkpO1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoVGVybSA9IHJvb21DYXRbJ3NlYXJjaF90ZXJtJ107XG5cbiAgICAgICAgICAgIGxldCByZXN1bHQ6IFJlc3VsdDtcblxuICAgICAgICAgICAgLy8gVE9ETyBleHRlbmQgbG9jYWwgZXZlbnQgbWFwIHVzaW5nIHNxbGl0ZS9sZXZlbGRiXG4gICAgICAgICAgICBzd2l0Y2ggKHJvb21DYXRbJ29yZGVyX2J5J10pIHtcbiAgICAgICAgICAgICAgICBjYXNlICdyYW5rJzpcbiAgICAgICAgICAgICAgICBjYXNlICcnOlxuICAgICAgICAgICAgICAgICAgICAvLyBnZXQgbWVzc2FnZXMgZnJvbSBCbGV2ZSBieSByYW5rIC8vIHJlc29sdmUgdGhlbSBsb2NhbGx5XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJhbmssIHNlYXJjaFRlcm0sIDAsIGV2ZW50Q29udGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAncmVjZW50JzpcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbSA9IG5leHRCYXRjaCAhPT0gbnVsbCA/IG5leHRCYXRjaC5mcm9tKCkgOiAwO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBzZWFyY2gucXVlcnkoa2V5cywgc2VhcmNoRmlsdGVyLCBTZWFyY2hPcmRlci5SZWNlbnQsIHNlYXJjaFRlcm0sIGZyb20sIGV2ZW50Q29udGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRPRE8gZ2V0IG5leHQgYmFjayBoZXJlXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAxKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoYWxsb3dlZEV2ZW50cy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBjb25zdCBoaWdobGlnaHRzU3VwZXJzZXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgIC8vIHJlc3Aucm93cy5mb3JFYWNoKChyb3c6IEJsZXZlUmVzcG9uc2VSb3cpID0+IHtcbiAgICAgICAgICAgIC8vICAgICByb3cuaGlnaGxpZ2h0cy5mb3JFYWNoKChoaWdobGlnaHQ6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgLy8gICAgICAgICBoaWdobGlnaHRzU3VwZXJzZXQuYWRkKGhpZ2hsaWdodCk7XG4gICAgICAgICAgICAvLyAgICAgfSk7XG4gICAgICAgICAgICAvLyB9KTtcblxuICAgICAgICAgICAgYWxsb3dlZEV2ZW50cy5mb3JFYWNoKChldklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByZXMgPSBldmVudE1hcFtldklkXTtcbiAgICAgICAgICAgICAgICBjb25zdCBldiA9IHJlcy5ldmVudDtcblxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gcm9vbUdyb3Vwcy5nZXQoZXYuZ2V0Um9vbUlkKCkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXYpIHYgPSBuZXcgR3JvdXBWYWx1ZSgpO1xuICAgICAgICAgICAgICAgICAgICB2LmFkZChldi5nZXRJZCgpLCByZXMub3JkZXIpO1xuICAgICAgICAgICAgICAgICAgICByb29tR3JvdXBzLnNldChldi5nZXRSb29tSWQoKSwgdik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gc2VuZGVyR3JvdXBzLmdldChldi5nZXRTZW5kZXIoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKCk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCksIHJlcy5vcmRlcik7XG4gICAgICAgICAgICAgICAgICAgIHNlbmRlckdyb3Vwcy5zZXQoZXYuZ2V0U2VuZGVyKCksIHYpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJvb21zLmFkZChldi5nZXRSb29tSWQoKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gVE9ETyBoaWdobGlnaHRzIGNhbGN1bGF0aW9uIG11c3QgcmVtYWluIG9uIGJsZXZlIHNpZGVcblxuICAgICAgICAgICAgY29uc3Qgcm9vbVN0YXRlTWFwID0gbmV3IE1hcDxzdHJpbmcsIEFycmF5PE1hdHJpeEV2ZW50Pj4oKTtcbiAgICAgICAgICAgIGlmIChpbmNsdWRlU3RhdGUpIHtcbiAgICAgICAgICAgICAgICAvLyBUT0RPIGZldGNoIHN0YXRlIGZyb20gc2VydmVyIHVzaW5nIEFQSVxuICAgICAgICAgICAgICAgIHJvb21zLmZvckVhY2goKHJvb21JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvb20gPSBjbGkuZ2V0Um9vbShyb29tSWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocm9vbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbVN0YXRlTWFwLnNldChyb29tSWQsIHJvb20uY3VycmVudFN0YXRlLnJlZHVjZSgoYWNjLCBtYXA6IE1hcDxzdHJpbmcsIE1hdHJpeEV2ZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjLnB1c2goZXYpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBbXSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdHM6IEFycmF5PE1hdHJpeEV2ZW50PiA9IGFsbG93ZWRFdmVudHMubWFwKChldmVudElkOiBzdHJpbmcpID0+IGV2ZW50TWFwW2V2ZW50SWRdLmV2ZW50KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzcCA9IHtcbiAgICAgICAgICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogaGlnaGxpZ2h0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5leHRCYXRjaDogZ2xvYmFsTmV4dEJhdGNoLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGU6IHJvb21TdGF0ZU1hcCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb3VudCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQgfHwgZ3JvdXBCeVNlbmRlcilcbiAgICAgICAgICAgICAgICByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzWydncm91cHMnXSA9IG5ldyBNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPj4oKTtcblxuICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQpIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHNbJ2dyb3VwcyddWydyb29tX2lkJ10gPSByb29tR3JvdXBzO1xuICAgICAgICAgICAgaWYgKGdyb3VwQnlTZW5kZXIpIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHNbJ2dyb3VwcyddWydzZW5kZXInXSA9IHNlbmRlckdyb3VwcztcblxuICAgICAgICAgICAgcmVzLmpzb24ocmVzcCk7XG5cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDYXRhc3Ryb3BoZVwiLCBlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKHJlcS5ib2R5KTtcbiAgICAgICAgcmVzLnNlbmRTdGF0dXMoMjAwKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IHBvcnQgPSA4MDAwO1xuICAgIGFwcC5saXN0ZW4ocG9ydCwgKCkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZygnV2UgYXJlIGxpdmUgb24gJyArIHBvcnQpO1xuICAgIH0pO1xufVxuXG5jbGFzcyBGaWx0ZXIge1xuICAgIHJvb21zOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RSb29tczogU2V0PHN0cmluZz47XG4gICAgc2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgbm90U2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgdHlwZXM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFR5cGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBsaW1pdDogbnVtYmVyO1xuICAgIGNvbnRhaW5zVVJMOiBib29sZWFuIHwgdW5kZWZpbmVkO1xuXG4gICAgY29uc3RydWN0b3Iobzogb2JqZWN0KSB7XG4gICAgICAgIHRoaXMucm9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1sncm9vbXMnXSk7XG4gICAgICAgIHRoaXMubm90Um9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3Jvb21zJ10pO1xuICAgICAgICB0aGlzLnNlbmRlcnMgPSBuZXcgU2V0PHN0cmluZz4ob1snc2VuZGVycyddKTtcbiAgICAgICAgdGhpcy5ub3RTZW5kZXJzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF9zZW5kZXJzJ10pO1xuICAgICAgICB0aGlzLnR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ3R5cGVzJ10pO1xuICAgICAgICB0aGlzLm5vdFR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF90eXBlcyddKTtcblxuICAgICAgICB0aGlzLmxpbWl0ID0gdHlwZW9mIG9bJ2xpbWl0J10gPT09IFwibnVtYmVyXCIgPyBvWydsaW1pdCddIDogMTA7XG4gICAgICAgIHRoaXMuY29udGFpbnNVUkwgPSBvWydjb250YWluc191cmwnXTtcbiAgICB9XG59XG5cbmludGVyZmFjZSBSZXF1ZXN0RXZlbnRDb250ZXh0IHtcbiAgICBiZWZvcmVfbGltaXQ/OiBudW1iZXI7XG4gICAgYWZ0ZXJfbGltaXQ/OiBudW1iZXI7XG4gICAgaW5jbHVkZV9wcm9maWxlOiBib29sZWFuO1xufVxuXG5lbnVtIFJlcXVlc3RHcm91cEtleSB7XG4gICAgcm9vbUlkID0gXCJyb29tX2lkXCIsXG4gICAgc2VuZGVyID0gXCJzZW5kZXJcIixcbn1cblxuaW50ZXJmYWNlIFJlcXVlc3RHcm91cCB7XG4gICAga2V5OiBSZXF1ZXN0R3JvdXBLZXk7XG59XG5cbmludGVyZmFjZSBSZXF1ZXN0R3JvdXBzIHtcbiAgICBncm91cF9ieT86IEFycmF5PFJlcXVlc3RHcm91cD47XG59XG5cbmVudW0gUmVxdWVzdEtleSB7XG4gICAgYm9keSA9IFwiY29udGVudC5ib2R5XCIsXG4gICAgbmFtZSA9IFwiY29udGVudC5uYW1lXCIsXG4gICAgdG9waWMgPSBcImNvbnRlbnQudG9waWNcIixcbn1cblxuaW50ZXJmYWNlIE1hdHJpeFNlYXJjaFJlcXVlc3RCb2R5IHtcbiAgICBzZWFyY2hfdGVybTogc3RyaW5nO1xuICAgIGtleXM/OiBBcnJheTxSZXF1ZXN0S2V5PjtcbiAgICBmaWx0ZXI/OiBvYmplY3Q7IC8vIHRoaXMgZ2V0cyB1cGNvbnZlcnRlZCB0byBhbiBpbnN0YW5jZSBvZiBGaWx0ZXJcbiAgICBvcmRlcl9ieT86IHN0cmluZztcbiAgICBldmVudF9jb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dDtcbiAgICBpbmNsdWRlU3RhdGU/OiBib29sZWFuO1xuICAgIGdyb3VwaW5ncz86IFJlcXVlc3RHcm91cHM7XG59XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXF1ZXN0IHtcbiAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICByb29tX2V2ZW50czogTWF0cml4U2VhcmNoUmVxdWVzdEJvZHk7XG4gICAgfVxufSJdfQ==