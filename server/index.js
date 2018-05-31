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
        console.log("Enqueue event: ", event.getRoomId(), event.getId());
        return cb(null, event.event);
    }
});
setup().then(console.log).catch(console.error);
Set.prototype.intersect = function (s) {
    return new Set([...this].filter(x => s.has(x)));
};
Set.prototype.union = function (s) {
    return new Set([...this, ...s]);
};
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
        // const r = new BleveRequest(keys, filter, orderBy, searchTerm, from, pageSize);
        console.log(JSON.stringify(r));
        const resp = await b.search(r);
        console.log("DEBUG: ", resp);
        return null;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFRQSxnREFBd0I7QUFDeEIsc0RBQW1EO0FBQ25ELDhEQUFxQztBQUNyQywrQ0FBaUM7QUFHakMsaUNBQWlDO0FBRWpDLCtDQUErQztBQUMvQyxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDdEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUM7QUFDbkQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFFM0MsTUFBTSx1QkFBdUIsR0FBRyxPQUFPLENBQUMsMERBQTBELENBQUMsQ0FBQyxPQUFPLENBQUM7QUFFNUcsa0RBQWtEO0FBQ2xELE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdkIsOEJBQThCO0FBQzlCLElBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsWUFBWSxLQUFLLElBQUk7SUFDMUUsTUFBTSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUVsRywwREFBMEQ7QUFDMUQsTUFBTSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFNUIsaURBYXVCO0FBRXZCLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0FBRWpELElBQUksU0FBUyxDQUFBO0FBRWIsa0VBQWtFO0FBQ2xFLDBEQUEwRDtBQUMxRCwrQkFBK0I7QUFFL0IsSUFBSSxTQUFTLEVBQUU7SUFDWCw0RkFBNEY7SUFDNUYsK0RBQStEO0NBQ2xFO0tBQU07SUFDSCxxQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLHVCQUF1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QVksQ0FBQztZQUV6RixHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1NBRWxCO1FBQUMsT0FBTyxDQUFDLEVBQUU7WUFDUixPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQztTQUNqQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3RCLEdBQUcsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDeEIsQ0FBQyxDQUFDLENBQUM7SUFFSCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUM7SUFDbEIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFO1FBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZGVjbGFyZSB2YXIgZ2xvYmFsOiB7XG4gICAgT2xtOiBhbnlcbiAgICBsb2NhbFN0b3JhZ2U/OiBhbnlcbiAgICBhdG9iOiAoc3RyaW5nKSA9PiBzdHJpbmc7XG59O1xuXG4vLyBpbXBvcnQgKiBhcyByZXF1ZXN0IGZyb20gXCJyZXF1ZXN0LXByb21pc2VcIjtcbmltcG9ydCB7UmVxdWVzdFByb21pc2UsIFJlcXVlc3RQcm9taXNlT3B0aW9uc30gZnJvbSBcInJlcXVlc3QtcHJvbWlzZVwiO1xuaW1wb3J0IGNvcnMgZnJvbSAnY29ycyc7XG5pbXBvcnQgZXhwcmVzcywge1JlcXVlc3QsIFJlc3BvbnNlfSBmcm9tIFwiZXhwcmVzc1wiO1xuaW1wb3J0IGJvZHlQYXJzZXIgZnJvbSAnYm9keS1wYXJzZXInO1xuaW1wb3J0ICogYXMgbWtkaXJwIGZyb20gXCJta2RpcnBcIjtcblxuaW1wb3J0IHtSZXF1ZXN0QVBJLCBSZXF1aXJlZFVyaVVybH0gZnJvbSBcInJlcXVlc3RcIjtcbi8vIGltcG9ydCBzcWxpdGUzIGZyb20gJ3NxbGl0ZTMnO1xuXG4vLyBjb25zdCBpbmRleGVkZGJqcyA9IHJlcXVpcmUoJ2luZGV4ZWRkYi1qcycpO1xuY29uc3QgUXVldWUgPSByZXF1aXJlKCdiZXR0ZXItcXVldWUnKTtcbmNvbnN0IFNxbGl0ZVN0b3JlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlLXNxbGl0ZScpO1xuY29uc3QgcmVxdWVzdCA9IHJlcXVpcmUoJ3JlcXVlc3QtcHJvbWlzZScpO1xuXG5jb25zdCBMb2NhbFN0b3JhZ2VDcnlwdG9TdG9yZSA9IHJlcXVpcmUoJ21hdHJpeC1qcy1zZGsvbGliL2NyeXB0by9zdG9yZS9sb2NhbFN0b3JhZ2UtY3J5cHRvLXN0b3JlJykuZGVmYXVsdDtcblxuLy8gY3JlYXRlIGRpcmVjdG9yeSB3aGljaCB3aWxsIGhvdXNlIHRoZSAzIHN0b3Jlcy5cbm1rZGlycC5zeW5jKCcuL3N0b3JlJyk7XG4vLyBMb2FkaW5nIGxvY2FsU3RvcmFnZSBtb2R1bGVcbmlmICh0eXBlb2YgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9PT0gXCJ1bmRlZmluZWRcIiB8fCBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBudWxsKVxuICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2UgPSBuZXcgKHJlcXVpcmUoJ25vZGUtbG9jYWxzdG9yYWdlJykuTG9jYWxTdG9yYWdlKSgnLi9zdG9yZS9sb2NhbFN0b3JhZ2UnKTtcblxuLy8gaW1wb3J0IE9sbSBiZWZvcmUgaW1wb3J0aW5nIGpzLXNkayB0byBwcmV2ZW50IGl0IGNyeWluZ1xuZ2xvYmFsLk9sbSA9IHJlcXVpcmUoJ29sbScpO1xuXG5pbXBvcnQge1xuICAgIFJvb20sXG4gICAgRXZlbnQsXG4gICAgTWF0cml4LFxuICAgIE1hdHJpeEV2ZW50LFxuICAgIGNyZWF0ZUNsaWVudCxcbiAgICBNYXRyaXhDbGllbnQsXG4gICAgSW5kZXhlZERCU3RvcmUsXG4gICAgRXZlbnRXaXRoQ29udGV4dCxcbiAgICBNYXRyaXhJbk1lbW9yeVN0b3JlLFxuICAgIEluZGV4ZWREQkNyeXB0b1N0b3JlLFxuICAgIHNldENyeXB0b1N0b3JlRmFjdG9yeSxcbiAgICBXZWJTdG9yYWdlU2Vzc2lvblN0b3JlLFxufSBmcm9tICdtYXRyaXgtanMtc2RrJztcblxuY29uc3QgdXRpbHMgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL3NyYy91dGlscycpO1xuXG5sZXQgaW5kZXhlZERCXG5cbi8vIGNvbnN0IGVuZ2luZSA9IG5ldyBzcWxpdGUzLkRhdGFiYXNlKCcuL3N0b3JlL2luZGV4ZWRiLnNxbGl0ZScpO1xuLy8gY29uc3Qgc2NvcGUgPSBpbmRleGVkZGJqcy5tYWtlU2NvcGUoJ3NxbGl0ZTMnLCBlbmdpbmUpO1xuLy8gaW5kZXhlZERCID0gc2NvcGUuaW5kZXhlZERCO1xuXG5pZiAoaW5kZXhlZERCKSB7XG4gICAgLy8gc2V0Q3J5cHRvU3RvcmVGYWN0b3J5KCgpID0+IG5ldyBJbmRleGVkREJDcnlwdG9TdG9yZShpbmRleGVkREIsICdtYXRyaXgtanMtc2RrOmNyeXB0bycpKTtcbiAgICAvLyBzZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IEluZGV4ZWREQkNyeXB0b1N0b3JlKG51bGwpKTtcbn0gZWxzZSB7XG4gICAgc2V0Q3J5cHRvU3RvcmVGYWN0b3J5KCgpID0+IG5ldyBMb2NhbFN0b3JhZ2VDcnlwdG9TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSk7XG59XG5cblxuY2xhc3MgQmxldmVIdHRwIHtcbiAgICByZXF1ZXN0OiBSZXF1ZXN0QVBJPFJlcXVlc3RQcm9taXNlLCBSZXF1ZXN0UHJvbWlzZU9wdGlvbnMsIFJlcXVpcmVkVXJpVXJsPjtcblxuICAgIGNvbnN0cnVjdG9yKGJhc2VVcmw6IHN0cmluZykge1xuICAgICAgICB0aGlzLnJlcXVlc3QgPSByZXF1ZXN0LmRlZmF1bHRzKHtcbiAgICAgICAgICAgIGJhc2VVcmwsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHNlYXJjaChyZXE6IEJsZXZlUmVxdWVzdCl7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAncXVlcnknLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogcmVxLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpbmRleChldmVudHM6IEV2ZW50W10pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgICB1cmw6ICdpbmRleCcsXG4gICAgICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICAgICAganNvbjogdHJ1ZSxcbiAgICAgICAgICAgIGJvZHk6IGV2ZW50cyxcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5jb25zdCBiID0gbmV3IEJsZXZlSHR0cChcImh0dHA6Ly9sb2NhbGhvc3Q6OTk5OS9hcGkvXCIpO1xuXG5jb25zdCBxID0gbmV3IFF1ZXVlKGFzeW5jIChiYXRjaDogRXZlbnRbXSwgY2IpID0+IHtcbiAgICBjb25zb2xlLmxvZyhiYXRjaCk7XG4gICAgdHJ5IHtcbiAgICAgICAgY2IobnVsbCwgYXdhaXQgYi5pbmRleChiYXRjaCkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2IoZSk7XG4gICAgfVxufSwge1xuICAgIGJhdGNoU2l6ZTogMTAwLFxuICAgIG1heFJldHJpZXM6IDEwLFxuICAgIHJldHJ5RGVsYXk6IDEwMDAsXG4gICAgc3RvcmU6IG5ldyBTcWxpdGVTdG9yZSh7XG4gICAgICAgIHBhdGg6ICcuL3N0b3JlL3F1ZXVlLnNxbGl0ZScsXG4gICAgfSksXG4gICAgZmlsdGVyOiAoZXZlbnQ6IE1hdHJpeEV2ZW50LCBjYikgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuZ2V0VHlwZSgpICE9PSAnbS5yb29tLm1lc3NhZ2UnKSByZXR1cm4gY2IoJ25vdCBtLnJvb20ubWVzc2FnZScpO1xuICAgICAgICBjb25zb2xlLmxvZyhcIkVucXVldWUgZXZlbnQ6IFwiLCBldmVudC5nZXRSb29tSWQoKSwgZXZlbnQuZ2V0SWQoKSk7XG4gICAgICAgIHJldHVybiBjYihudWxsLCBldmVudC5ldmVudCk7XG4gICAgfVxufSk7XG5cbnNldHVwKCkudGhlbihjb25zb2xlLmxvZykuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbmRlY2xhcmUgZ2xvYmFsIHtcbiAgICBpbnRlcmZhY2UgU2V0PFQ+IHtcbiAgICAgICAgaW50ZXJzZWN0PFQ+KHM6IFNldDxUPik6IFNldDxUPjtcbiAgICAgICAgdW5pb248VD4oczogU2V0PFQ+KTogU2V0PFQ+O1xuICAgIH1cbn1cblxuU2V0LnByb3RvdHlwZS5pbnRlcnNlY3QgPSBmdW5jdGlvbjxUPihzOiBTZXQ8VD4pOiBTZXQ8VD4ge1xuICAgIHJldHVybiBuZXcgU2V0PFQ+KFsuLi50aGlzXS5maWx0ZXIoeCA9PiBzLmhhcyh4KSkpO1xufTtcblNldC5wcm90b3R5cGUudW5pb24gPSBmdW5jdGlvbjxUPihzOiBTZXQ8VD4pOiBTZXQ8VD4ge1xuICAgIHJldHVybiBuZXcgU2V0PFQ+KFsuLi50aGlzLCAuLi5zXSk7XG59O1xuXG5jbGFzcyBGaWx0ZXIge1xuICAgIHJvb21zOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RSb29tczogU2V0PHN0cmluZz47XG4gICAgc2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgbm90U2VuZGVyczogU2V0PHN0cmluZz47XG4gICAgdHlwZXM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFR5cGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBsaW1pdDogbnVtYmVyO1xuICAgIGNvbnRhaW5zVVJMOiBib29sZWFuIHwgdW5kZWZpbmVkO1xuXG4gICAgY29uc3RydWN0b3Iobzogb2JqZWN0KSB7XG4gICAgICAgIHRoaXMucm9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1sncm9vbXMnXSk7XG4gICAgICAgIHRoaXMubm90Um9vbXMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3Jvb21zJ10pO1xuICAgICAgICB0aGlzLnNlbmRlcnMgPSBuZXcgU2V0PHN0cmluZz4ob1snc2VuZGVycyddKTtcbiAgICAgICAgdGhpcy5ub3RTZW5kZXJzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF9zZW5kZXJzJ10pO1xuICAgICAgICB0aGlzLnR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ3R5cGVzJ10pO1xuICAgICAgICB0aGlzLm5vdFR5cGVzID0gbmV3IFNldDxzdHJpbmc+KG9bJ25vdF90eXBlcyddKTtcblxuICAgICAgICB0aGlzLmxpbWl0ID0gdHlwZW9mIG9bJ2xpbWl0J10gPT09IFwibnVtYmVyXCIgPyBvWydsaW1pdCddIDogMTA7XG4gICAgICAgIHRoaXMuY29udGFpbnNVUkwgPSBvWydjb250YWluc191cmwnXTtcbiAgICB9XG59XG5cbmNsYXNzIFJlc3VsdCB7XG4gICAgcHVibGljIHJhbms6IG51bWJlcjtcbiAgICBwdWJsaWMgZXZlbnQ6IE1hdHJpeEV2ZW50O1xuXG4gICAgY29uc3RydWN0b3IoZXZlbnQ6IE1hdHJpeEV2ZW50LCByYW5rOiBudW1iZXIpIHtcbiAgICAgICAgdGhpcy5ldmVudCA9IGV2ZW50O1xuICAgICAgICB0aGlzLnJhbmsgPSByYW5rO1xuICAgIH1cbn1cblxuY2xhc3MgR3JvdXBWYWx1ZSB7XG4gICAgcHVibGljIG9yZGVyOiBudW1iZXJ8dW5kZWZpbmVkO1xuICAgIHB1YmxpYyBuZXh0QmF0Y2g6IHN0cmluZztcbiAgICBwdWJsaWMgcmVzdWx0czogQXJyYXk8c3RyaW5nPjtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICB0aGlzLm9yZGVyID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLm5leHRCYXRjaCA9IFwiXCI7XG4gICAgICAgIHRoaXMucmVzdWx0cyA9IFtdO1xuICAgIH1cblxuICAgIGFkZChldmVudElkOiBzdHJpbmcsIG9yZGVyOiBudW1iZXIpIHtcbiAgICAgICAgaWYgKHRoaXMub3JkZXIgPT09IHVuZGVmaW5lZCkgdGhpcy5vcmRlciA9IG9yZGVyO1xuICAgICAgICB0aGlzLnJlc3VsdHMucHVzaChldmVudElkKTtcbiAgICB9XG59XG5cbmNsYXNzIEJhdGNoIHtcbiAgICBwdWJsaWMgVG9rZW46IG51bWJlcjtcbiAgICBwdWJsaWMgR3JvdXA6IHN0cmluZztcbiAgICBwdWJsaWMgR3JvdXBLZXk6IHN0cmluZztcblxuICAgIGNvbnN0cnVjdG9yKFRva2VuOiBudW1iZXIgPSAwLCBHcm91cDogc3RyaW5nLCBHcm91cEtleTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuVG9rZW4gPSBUb2tlbjtcbiAgICAgICAgdGhpcy5Hcm91cCA9IEdyb3VwO1xuICAgICAgICB0aGlzLkdyb3VwS2V5ID0gR3JvdXBLZXk7XG4gICAgfVxuXG4gICAgc3RhdGljIGZyb21TdHJpbmcoZnJvbTogc3RyaW5nKTogQmF0Y2ggfCB1bmRlZmluZWQge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgbyA9IEpTT04ucGFyc2UoZnJvbSk7XG4gICAgICAgICAgICAvLyBjb25zdCBiID0gbmV3IEJhdGNoKG8pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnJvbSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuVG9rZW47XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBUb2tlbjogdGhpcy5Ub2tlbixcbiAgICAgICAgICAgIEdyb3VwOiB0aGlzLkdyb3VwLFxuICAgICAgICAgICAgR3JvdXBLZXk6IHRoaXMuR3JvdXBLZXksXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuaW50ZXJmYWNlIFF1ZXJ5IHtcbiAgICBtdXN0OiBNYXA8c3RyaW5nLCBBcnJheTxzdHJpbmc+PjtcbiAgICBtdXN0Tm90OiBNYXA8c3RyaW5nLCBBcnJheTxzdHJpbmc+Pjtcbn1cblxuaW50ZXJmYWNlIEJsZXZlUmVxdWVzdCB7XG4gICAga2V5czogQXJyYXk8c3RyaW5nPjtcbiAgICBmaWx0ZXI6IFF1ZXJ5O1xuICAgIHNvcnRCeTogU2VhcmNoT3JkZXI7XG4gICAgc2VhcmNoVGVybTogc3RyaW5nO1xuICAgIGZyb206IG51bWJlcjtcbiAgICBzaXplOiBudW1iZXI7XG59XG5cbmNvbnN0IHBhZ2VTaXplID0gMTA7XG5cbmludGVyZmFjZSBCbGV2ZVJlc3BvbnNlUm93IHtcbiAgICByb29tSWQ6IHN0cmluZztcbiAgICBldmVudElkOiBzdHJpbmc7XG4gICAgc2NvcmU6IG51bWJlcjtcbiAgICBoaWdobGlnaHRzOiBTZXQ8c3RyaW5nPjtcbn1cblxuaW50ZXJmYWNlIEJsZXZlUmVzcG9uc2Uge1xuICAgIHJvd3M6IEFycmF5PEJsZXZlUmVzcG9uc2VSb3c+O1xuICAgIHRvdGFsOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBFdmVudExvb2t1cENvbnRleHQge1xuICAgIHN0YXJ0OiBzdHJpbmc7XG4gICAgZW5kOiBzdHJpbmc7XG4gICAgZXZlbnRzQmVmb3JlOiBBcnJheTxNYXRyaXhFdmVudD47XG4gICAgZXZlbnRzQWZ0ZXI6IEFycmF5PE1hdHJpeEV2ZW50PjtcbiAgICBzdGF0ZTogQXJyYXk8TWF0cml4RXZlbnQ+O1xufVxuXG5pbnRlcmZhY2UgRXZlbnRMb29rdXBSZXN1bHQge1xuICAgIGV2ZW50OiBNYXRyaXhFdmVudDtcbiAgICBzY29yZTogbnVtYmVyO1xuICAgIGNvbnRleHQ6IEV2ZW50TG9va3VwQ29udGV4dCB8IG51bGw7XG4gICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG59XG5cbk1hdHJpeENsaWVudC5wcm90b3R5cGUuZmV0Y2hFdmVudCA9IGFzeW5jIGZ1bmN0aW9uKHJvb21JZDogc3RyaW5nLCBldmVudElkOiBzdHJpbmcpOiBQcm9taXNlPE1hdHJpeEV2ZW50PiB7XG4gICAgY29uc3QgcGF0aCA9IHV0aWxzLmVuY29kZVVyaSgnL3Jvb21zLyRyb29tSWQvZXZlbnQvJGV2ZW50SWQnLCB7XG4gICAgICAgICRyb29tSWQ6IHJvb21JZCxcbiAgICAgICAgJGV2ZW50SWQ6IGV2ZW50SWQsXG4gICAgfSk7XG5cbiAgICBsZXQgcmVzO1xuICAgIHRyeSB7XG4gICAgICAgIHJlcyA9IGF3YWl0IHRoaXMuX2h0dHAuYXV0aGVkUmVxdWVzdCh1bmRlZmluZWQsICdHRVQnLCBwYXRoKTtcbiAgICB9IGNhdGNoIChlKSB7fVxuXG4gICAgaWYgKCFyZXMgfHwgIXJlcy5ldmVudClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiJ2V2ZW50JyBub3QgaW4gJy9ldmVudCcgcmVzdWx0IC0gaG9tZXNlcnZlciB0b28gb2xkP1wiKTtcblxuICAgIHJldHVybiB0aGlzLmdldEV2ZW50TWFwcGVyKCkocmVzLmV2ZW50KTtcbn07XG5cbi8vIFwiZHVtYlwiIG1hcHBlciBiZWNhdXNlIGUyZSBzaG91bGQgYmUgZGVjcnlwdGVkIGluIGJyb3dzZXIsIHNvIHdlIGRvbid0IGxvc2UgdmVyaWZpY2F0aW9uIHN0YXR1c1xuZnVuY3Rpb24gbWFwcGVyKGNsaTogTWF0cml4Q2xpZW50LCBwbGFpbk9sZEpzT2JqZWN0OiBFdmVudCk6IE1hdHJpeEV2ZW50IHtcbiAgICByZXR1cm4gbmV3IE1hdHJpeEV2ZW50KHBsYWluT2xkSnNPYmplY3QpO1xufVxuXG4vLyBYWFg6IHVzZSBnZXRFdmVudFRpbWVsaW5lIG9uY2Ugd2Ugc3RvcmUgcm9vbXMgcHJvcGVybHlcbk1hdHJpeENsaWVudC5wcm90b3R5cGUuZmV0Y2hFdmVudENvbnRleHQgPSBhc3luYyBmdW5jdGlvbihyb29tSWQ6IHN0cmluZywgZXZlbnRJZDogc3RyaW5nKTogUHJvbWlzZTxFdmVudFdpdGhDb250ZXh0PiB7XG4gICAgY29uc3QgcGF0aCA9IHV0aWxzLmVuY29kZVVyaSgnL3Jvb21zLyRyb29tSWQvY29udGV4dC8kZXZlbnRJZCcsIHtcbiAgICAgICAgJHJvb21JZDogcm9vbUlkLFxuICAgICAgICAkZXZlbnRJZDogZXZlbnRJZCxcbiAgICB9KTtcblxuICAgIGxldCByZXM7XG4gICAgdHJ5IHtcbiAgICAgICAgcmVzID0gYXdhaXQgdGhpcy5faHR0cC5hdXRoZWRSZXF1ZXN0KHVuZGVmaW5lZCwgJ0dFVCcsIHBhdGgpO1xuICAgIH0gY2F0Y2ggKGUpIHt9XG5cbiAgICBpZiAoIXJlcyB8fCAhcmVzLmV2ZW50KVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCInZXZlbnQnIG5vdCBpbiAnL2V2ZW50JyByZXN1bHQgLSBob21lc2VydmVyIHRvbyBvbGQ/XCIpO1xuXG4gICAgLy8gY29uc3QgbWFwcGVyID0gdGhpcy5nZXRFdmVudE1hcHBlcigpO1xuXG4gICAgY29uc3QgZXZlbnQgPSBtYXBwZXIodGhpcywgcmVzLmV2ZW50KTtcblxuICAgIGNvbnN0IHN0YXRlID0gdXRpbHMubWFwKHJlcy5zdGF0ZSwgbWFwcGVyKTtcbiAgICBjb25zdCBldmVudHNfYWZ0ZXIgPSB1dGlscy5tYXAocmVzLmV2ZW50c19hZnRlciwgbWFwcGVyKTtcbiAgICBjb25zdCBldmVudHNfYmVmb3JlID0gdXRpbHMubWFwKHJlcy5ldmVudHNfYmVmb3JlLCBtYXBwZXIpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZXZlbnQsXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIHN0YXRlLFxuICAgICAgICAgICAgZXZlbnRzX2FmdGVyLFxuICAgICAgICAgICAgZXZlbnRzX2JlZm9yZSxcbiAgICAgICAgfSxcbiAgICB9O1xufTtcblxuY2xhc3MgU2VhcmNoIHtcbiAgICBjbGk6IE1hdHJpeENsaWVudDtcblxuICAgIGNvbnN0cnVjdG9yKGNsaTogTWF0cml4Q2xpZW50KSB7XG4gICAgICAgIHRoaXMuY2xpID0gY2xpO1xuICAgIH1cblxuICAgIC8vIGltcGVkYW5jZSBtYXRjaGluZy5cbiAgICBhc3luYyByZXNvbHZlT25lKHJvb21JZDogc3RyaW5nLCBldmVudElkOiBzdHJpbmcsIGNvbnRleHQ6IGJvb2xlYW4pOiBQcm9taXNlPEV2ZW50V2l0aENvbnRleHQ+IHtcbiAgICAgICAgaWYgKGNvbnRleHQpXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGkuZmV0Y2hFdmVudENvbnRleHQocm9vbUlkLCBldmVudElkKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZXZlbnQ6IGF3YWl0IHRoaXMuY2xpLmZldGNoRXZlbnQocm9vbUlkLCBldmVudElkKSxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBrZWVwIGNvbnRleHQgYXMgYSBtYXAsIHNvIHRoZSB3aG9sZSB0aGluZyBjYW4ganVzdCBiZSBudWxsZWQuXG4gICAgYXN5bmMgcmVzb2x2ZShyb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PiwgY29udGV4dDogYm9vbGVhbik6IFByb21pc2U8QXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+PiB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyBrZXlzOiBwYXNzIHN0cmFpZ2h0IHRocm91Z2ggdG8gZ28tYmxldmVcbiAgICAvLyBzZWFyY2hGaWx0ZXI6IGNvbXB1dGUgYW5kIHNlbmQgc2VhcmNoIHJ1bGVzIHRvIGdvLWJsZXZlXG4gICAgLy8gcm9vbUlEc1NldDogdXNlZCB3aXRoIGFib3ZlIC9cXFxuICAgIC8vIHNvcnRCeTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gc2VhcmNoVGVybTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gZnJvbTogcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgLy8gY29udGV4dDogYnJhbmNoIG9uIHdoZXRoZXIgb3Igbm90IHRvIGZldGNoIGNvbnRleHQvZXZlbnRzIChqcy1zZGsgb25seSBzdXBwb3J0cyBjb250ZXh0IGF0IHRoaXMgdGltZSBpaXJjKVxuICAgIGFzeW5jIHF1ZXJ5KGtleXM6IEFycmF5PHN0cmluZz4sIHNlYXJjaEZpbHRlcjogRmlsdGVyLCBzb3J0Qnk6IFNlYXJjaE9yZGVyLCBzZWFyY2hUZXJtOiBzdHJpbmcsIGZyb206IG51bWJlciwgY29udGV4dDogYm9vbGVhbik6IFByb21pc2U8QXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+fG51bGw+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyOiBRdWVyeSA9IHtcbiAgICAgICAgICAgIG11c3ROb3Q6IG5ldyBNYXAoKSxcbiAgICAgICAgICAgIG11c3Q6IG5ldyBNYXAoKSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgcm9vbV9pZFxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdyb29tX2lkJywgWy4uLnNlYXJjaEZpbHRlci5yb29tc10pO1xuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLm5vdFJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdyb29tX2lkJywgWy4uLnNlYXJjaEZpbHRlci5ub3RSb29tc10pO1xuXG4gICAgICAgIC8vIG11c3Qgc2F0aXNmeSBzZW5kZXJcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5zZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdzZW5kZXInLCBbLi4uc2VhcmNoRmlsdGVyLnNlbmRlcnNdKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdzZW5kZXInLCBbLi4uc2VhcmNoRmlsdGVyLm5vdFNlbmRlcnNdKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgdHlwZVxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnR5cGVzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCd0eXBlJywgWy4uLnNlYXJjaEZpbHRlci50eXBlc10pO1xuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLm5vdFR5cGVzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCd0eXBlJywgWy4uLnNlYXJjaEZpbHRlci5ub3RUeXBlc10pO1xuXG4gICAgICAgIGNvbnN0IHI6IEJsZXZlUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGZyb20sXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgZmlsdGVyLFxuICAgICAgICAgICAgc29ydEJ5LFxuICAgICAgICAgICAgc2VhcmNoVGVybSxcbiAgICAgICAgICAgIHNpemU6IHBhZ2VTaXplLFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIGNvbnN0IHIgPSBuZXcgQmxldmVSZXF1ZXN0KGtleXMsIGZpbHRlciwgb3JkZXJCeSwgc2VhcmNoVGVybSwgZnJvbSwgcGFnZVNpemUpO1xuICAgICAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyKSk7XG5cbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGIuc2VhcmNoKHIpO1xuICAgICAgICBjb25zb2xlLmxvZyhcIkRFQlVHOiBcIiwgcmVzcCk7XG5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5lbnVtIFNlYXJjaE9yZGVyIHtcbiAgICBSYW5rID0gJ3JhbmsnLFxuICAgIFJlY2VudCA9ICdyZWNlbnQnLFxufVxuXG5hc3luYyBmdW5jdGlvbiBzZXR1cCgpIHtcbiAgICBsZXQgY3JlZHMgPSB7XG4gICAgICAgIHVzZXJJZDogZ2xvYmFsLmxvY2FsU3RvcmFnZS5nZXRJdGVtKCd1c2VySWQnKSxcbiAgICAgICAgZGV2aWNlSWQ6IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGV2aWNlSWQnKSxcbiAgICAgICAgYWNjZXNzVG9rZW46IGdsb2JhbC5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnYWNjZXNzVG9rZW4nKSxcbiAgICB9O1xuXG4gICAgaWYgKCFjcmVkcy51c2VySWQgfHwgIWNyZWRzLmRldmljZUlkIHx8ICFjcmVkcy5hY2Nlc3NUb2tlbikge1xuICAgICAgICBjb25zdCBsb2dpbkNsaWVudCA9IGNyZWF0ZUNsaWVudCh7XG4gICAgICAgICAgICBiYXNlVXJsOiAnaHR0cHM6Ly9tYXRyaXgub3JnJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGxvZ2luQ2xpZW50LmxvZ2luKCdtLmxvZ2luLnBhc3N3b3JkJywge1xuICAgICAgICAgICAgICAgIHVzZXI6ICdAd2ViZGV2Z3VydTptYXRyaXgub3JnJyxcbiAgICAgICAgICAgICAgICBwYXNzd29yZDogJ3RsRCRANVpDVVc0MVkjSGcnLFxuICAgICAgICAgICAgICAgIGluaXRpYWxfZGV2aWNlX2Rpc3BsYXlfbmFtZTogJ01hdHJpeCBTZWFyY2ggRGFlbW9uJyxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTG9nZ2VkIGluIGFzICcgKyByZXMudXNlcl9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ3VzZXJJZCcsIHJlcy51c2VyX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnZGV2aWNlSWQnLCByZXMuZGV2aWNlX2lkKTtcbiAgICAgICAgICAgIGdsb2JhbC5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgnYWNjZXNzVG9rZW4nLCByZXMuYWNjZXNzX3Rva2VuKTtcblxuICAgICAgICAgICAgY3JlZHMgPSB7XG4gICAgICAgICAgICAgICAgdXNlcklkOiByZXMudXNlcl9pZCxcbiAgICAgICAgICAgICAgICBkZXZpY2VJZDogcmVzLmRldmljZV9pZCxcbiAgICAgICAgICAgICAgICBhY2Nlc3NUb2tlbjogcmVzLmFjY2Vzc190b2tlbixcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0FuIGVycm9yIG9jY3VyZWQgbG9nZ2luZyBpbiEnKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGVycik7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGkgPSBjcmVhdGVDbGllbnQoe1xuICAgICAgICBiYXNlVXJsOiAnaHR0cHM6Ly9tYXRyaXgub3JnJyxcbiAgICAgICAgaWRCYXNlVXJsOiAnJyxcbiAgICAgICAgLi4uY3JlZHMsXG4gICAgICAgIHVzZUF1dGhvcml6YXRpb25IZWFkZXI6IHRydWUsXG4gICAgICAgIC8vIHNlc3Npb25TdG9yZTogbmV3IExldmVsU3RvcmUoKSxcbiAgICAgICAgLy8gc3RvcmU6IG5ldyBJbmRleGVkREJTdG9yZSh7XG4gICAgICAgIC8vICAgICBpbmRleGVkREI6IGluZGV4ZWREQixcbiAgICAgICAgLy8gICAgIGRiTmFtZTogJ21hdHJpeC1zZWFyY2gtc3luYycsXG4gICAgICAgIC8vICAgICBsb2NhbFN0b3JhZ2U6IGdsb2JhbC5sb2NhbFN0b3JhZ2UsXG4gICAgICAgIC8vIH0pLFxuICAgICAgICBzdG9yZTogbmV3IE1hdHJpeEluTWVtb3J5U3RvcmUoe1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlOiBnbG9iYWwubG9jYWxTdG9yYWdlLFxuICAgICAgICB9KSxcbiAgICAgICAgc2Vzc2lvblN0b3JlOiBuZXcgV2ViU3RvcmFnZVNlc3Npb25TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSxcbiAgICB9KTtcblxuICAgIGNsaS5vbignZXZlbnQnLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5pc0VuY3J5cHRlZCgpKSByZXR1cm47XG4gICAgICAgIHJldHVybiBxLnB1c2goZXZlbnQpO1xuICAgIH0pO1xuICAgIGNsaS5vbignRXZlbnQuZGVjcnlwdGVkJywgKGV2ZW50OiBNYXRyaXhFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuaXNEZWNyeXB0aW9uRmFpbHVyZSgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oZXZlbnQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBxLnB1c2goZXZlbnQpO1xuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY2xpLmluaXRDcnlwdG8oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH1cbiAgICBjbGkuc3RhcnRDbGllbnQoKTtcbiAgICAvLyBwcm9jZXNzLmV4aXQoMSk7XG5cbiAgICBjb25zdCBhcHAgPSBleHByZXNzKCk7XG4gICAgYXBwLnVzZShib2R5UGFyc2VyLmpzb24oKSk7XG4gICAgYXBwLnVzZShjb3JzKHtcbiAgICAgICAgJ2FsbG93ZWRIZWFkZXJzJzogWydhY2Nlc3NfdG9rZW4nLCAnQ29udGVudC1UeXBlJ10sXG4gICAgICAgICdleHBvc2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJ10sXG4gICAgICAgICdvcmlnaW4nOiAnKicsXG4gICAgICAgICdtZXRob2RzJzogJ1BPU1QnLFxuICAgICAgICAncHJlZmxpZ2h0Q29udGludWUnOiBmYWxzZVxuICAgIH0pKTtcblxuICAgIGFwcC5wb3N0KCcvc2VhcmNoJywgYXN5bmMgKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoIXJlcS5ib2R5KSB7XG4gICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg0MDApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IG5leHRCYXRjaDogQmF0Y2ggfCBudWxsID0gbnVsbDtcbiAgICAgICAgaWYgKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIG5leHRCYXRjaCA9IEpTT04ucGFyc2UoZ2xvYmFsLmF0b2IocmVxLnF1ZXJ5WyduZXh0X2JhdGNoJ10pKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmluZm8oXCJGb3VuZCBuZXh0IGJhdGNoIG9mXCIsIG5leHRCYXRjaCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBwYXJzZSBuZXh0X2JhdGNoIGFyZ3VtZW50XCIsIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gdmVyaWZ5IHRoYXQgdXNlciBpcyBhbGxvd2VkIHRvIGFjY2VzcyB0aGlzIHRoaW5nXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByb29tQ2F0ID0gcmVxLmJvZHlbJ3NlYXJjaF9jYXRlZ29yaWVzJ11bJ3Jvb21fZXZlbnRzJ107XG5cbiAgICAgICAgICAgIGxldCBrZXlzID0gWydjb250ZW50LmJvZHknLCAnY29udGVudC5uYW1lJywgJ2NvbnRlbnQudG9waWMnXTtcbiAgICAgICAgICAgIGlmICgna2V5cycgaW4gcm9vbUNhdCAmJiByb29tQ2F0LmtleXMubGVuZ3RoKSBrZXlzID0gcm9vbUNhdC5rZXlzXG5cbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGVTdGF0ZSA9IEJvb2xlYW4ocm9vbUNhdFsnaW5jbHVkZV9zdGF0ZSddKTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50Q29udGV4dCA9IHJvb21DYXRbJ2V2ZW50X2NvbnRleHQnXTtcblxuICAgICAgICAgICAgbGV0IGdyb3VwQnlSb29tSWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxldCBncm91cEJ5U2VuZGVyID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAoJ2dyb3VwaW5ncycgaW4gcm9vbUNhdCkge1xuICAgICAgICAgICAgICAgIHJvb21DYXQuZ3JvdXBpbmdzLmZvckVhY2goZ3JvdXBpbmcgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGdyb3VwaW5nLmtleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAncm9vbV9pZCc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBCeVJvb21JZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwQnlTZW5kZXIgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBoaWdobGlnaHRzOiBBcnJheTxzdHJpbmc+ID0gW107XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlciA9IG5ldyBGaWx0ZXIocm9vbUNhdC5maWx0ZXIpO1xuXG4gICAgICAgICAgICBjb25zdCBqb2luZWRSb29tcyA9IGNsaS5nZXRSb29tcygpO1xuICAgICAgICAgICAgY29uc3Qgcm9vbUlkcyA9IGpvaW5lZFJvb21zLm1hcCgocm9vbTogUm9vbSkgPT4gcm9vbS5yb29tSWQpO1xuXG4gICAgICAgICAgICBpZiAocm9vbUlkcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTS0lQIGZvciBub3dcbiAgICAgICAgICAgIC8vIGxldCByb29tSWRzU2V0ID0gc2VhcmNoRmlsdGVyLmZpbHRlclJvb21zKHJvb21JZHMpO1xuXG4gICAgICAgICAgICAvLyBpZiAoYi5pc0dyb3VwaW5nKFwicm9vbV9pZFwiKSkge1xuICAgICAgICAgICAgLy8gICAgIHJvb21JRHNTZXQuSW50ZXJzZWN0KGNvbW1vbi5OZXdTdHJpbmdTZXQoW11zdHJpbmd7KmIuR3JvdXBLZXl9KSlcbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgLy8gVE9ETyBkbyB3ZSBuZWVkIHRoaXNcbiAgICAgICAgICAgIC8vcmFua01hcCA6PSBtYXBbc3RyaW5nXWZsb2F0NjR7fVxuICAgICAgICAgICAgLy9hbGxvd2VkRXZlbnRzIDo9IFtdKlJlc3VsdHt9XG4gICAgICAgICAgICAvLyBUT0RPIHRoZXNlIG5lZWQgY2hhbmdpbmdcbiAgICAgICAgICAgIGNvbnN0IHJvb21Hcm91cHMgPSBuZXcgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4oKTtcbiAgICAgICAgICAgIGNvbnN0IHNlbmRlckdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuXG4gICAgICAgICAgICBsZXQgZ2xvYmFsTmV4dEJhdGNoOiBzdHJpbmd8bnVsbCA9IG51bGw7XG4gICAgICAgICAgICBsZXQgY291bnQ6IG51bWJlciA9IDA7XG5cbiAgICAgICAgICAgIGxldCBhbGxvd2VkRXZlbnRzOiBBcnJheTxzdHJpbmc+ID0gW107XG4gICAgICAgICAgICBjb25zdCBldmVudE1hcCA9IG5ldyBNYXA8c3RyaW5nLCBSZXN1bHQ+KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21zID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaCA9IG5ldyBTZWFyY2goY2xpKTtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaFRlcm0gPSByb29tQ2F0WydzZWFyY2hfdGVybSddO1xuXG4gICAgICAgICAgICAvLyBUT0RPIGV4dGVuZCBsb2NhbCBldmVudCBtYXAgdXNpbmcgc3FsaXRlL2xldmVsZGJcbiAgICAgICAgICAgIHN3aXRjaCAocm9vbUNhdFsnb3JkZXJfYnknXSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3JhbmsnOlxuICAgICAgICAgICAgICAgIGNhc2UgJyc6XG4gICAgICAgICAgICAgICAgICAgIC8vIGdldCBtZXNzYWdlcyBmcm9tIEJsZXZlIGJ5IHJhbmsgLy8gcmVzb2x2ZSB0aGVtIGxvY2FsbHlcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoLnF1ZXJ5KGtleXMsIHNlYXJjaEZpbHRlciwgU2VhcmNoT3JkZXIuUmFuaywgc2VhcmNoVGVybSwgMCwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdyZWNlbnQnOlxuICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tID0gbmV4dEJhdGNoICE9PSBudWxsID8gbmV4dEJhdGNoLmZyb20oKSA6IDA7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJlY2VudCwgc2VhcmNoVGVybSwgZnJvbSwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBnZXQgbmV4dCBiYWNrIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDEpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhbGxvd2VkRXZlbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGFsbG93ZWRFdmVudHMuZm9yRWFjaCgoZXZJZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzID0gZXZlbnRNYXBbZXZJZF07XG4gICAgICAgICAgICAgICAgY29uc3QgZXYgPSByZXMuZXZlbnQ7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdiA9IHJvb21Hcm91cHMuZ2V0KGV2LmdldFJvb21JZCgpKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF2KSB2ID0gbmV3IEdyb3VwVmFsdWUoKTtcbiAgICAgICAgICAgICAgICAgICAgdi5hZGQoZXYuZ2V0SWQoKSwgcmVzLm9yZGVyKTtcbiAgICAgICAgICAgICAgICAgICAgcm9vbUdyb3Vwcy5zZXQoZXYuZ2V0Um9vbUlkKCksIHYpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVNlbmRlcikge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdiA9IHNlbmRlckdyb3Vwcy5nZXQoZXYuZ2V0U2VuZGVyKCkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXYpIHYgPSBuZXcgR3JvdXBWYWx1ZSgpO1xuICAgICAgICAgICAgICAgICAgICB2LmFkZChldi5nZXRJZCgpLCByZXMub3JkZXIpO1xuICAgICAgICAgICAgICAgICAgICBzZW5kZXJHcm91cHMuc2V0KGV2LmdldFNlbmRlcigpLCB2KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByb29tcy5hZGQoZXYuZ2V0Um9vbUlkKCkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFRPRE8gaGlnaGxpZ2h0cyBjYWxjdWxhdGlvbiBtdXN0IHJlbWFpbiBvbiBibGV2ZSBzaWRlXG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21TdGF0ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTxNYXRyaXhFdmVudD4+KCk7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETyBmZXRjaCBzdGF0ZSBmcm9tIHNlcnZlciB1c2luZyBBUElcbiAgICAgICAgICAgICAgICByb29tcy5mb3JFYWNoKChyb29tSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByb29tID0gY2xpLmdldFJvb20ocm9vbUlkKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJvb20pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvb21TdGF0ZU1hcC5zZXQocm9vbUlkLCByb29tLmN1cnJlbnRTdGF0ZS5yZWR1Y2UoKGFjYywgbWFwOiBNYXA8c3RyaW5nLCBNYXRyaXhFdmVudD4pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXAuZm9yRWFjaCgoZXY6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjYy5wdXNoKGV2KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSwgW10pKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTxNYXRyaXhFdmVudD4gPSBhbGxvd2VkRXZlbnRzLm1hcCgoZXZlbnRJZDogc3RyaW5nKSA9PiBldmVudE1hcFtldmVudElkXS5ldmVudCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3AgPSB7XG4gICAgICAgICAgICAgICAgc2VhcmNoX2NhdGVnb3JpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IGhpZ2hsaWdodHMsXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXh0QmF0Y2g6IGdsb2JhbE5leHRCYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlOiByb29tU3RhdGVNYXAsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgY291bnQsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkIHx8IGdyb3VwQnlTZW5kZXIpXG4gICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50c1snZ3JvdXBzJ10gPSBuZXcgTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+KCk7XG5cbiAgICAgICAgICAgIGlmIChncm91cEJ5Um9vbUlkKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzWydncm91cHMnXVsncm9vbV9pZCddID0gcm9vbUdyb3VwcztcbiAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzWydncm91cHMnXVsnc2VuZGVyJ10gPSBzZW5kZXJHcm91cHM7XG5cbiAgICAgICAgICAgIHJlcy5qc29uKHJlc3ApO1xuXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ2F0YXN0cm9waGVcIiwgZSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhyZXEuYm9keSk7XG4gICAgICAgIHJlcy5zZW5kU3RhdHVzKDIwMCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBwb3J0ID0gODAwMDtcbiAgICBhcHAubGlzdGVuKHBvcnQsICgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ1dlIGFyZSBsaXZlIG9uICcgKyBwb3J0KTtcbiAgICB9KTtcbn1cbiJdfQ==