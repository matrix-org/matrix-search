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
global.Olm = require('olm');
const matrix_js_sdk_1 = require("matrix-js-sdk");
// import StubStore from 'matrix-js-sdk/src/store/stub.js';
// import * as LevelStore from './level-store';
// import * as Promise from 'bluebird';
// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null) {
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store');
}
const sqlite3 = require('sqlite3');
const indexeddbjs = require('indexeddb-js');
const request = __importStar(require("request-promise"));
// const request = require('request-promise');
const Queue = require('better-queue');
const engine = new sqlite3.Database('./store.sqlite');
const scope = indexeddbjs.makeScope('sqlite3', engine);
const indexedDB = scope.indexedDB;
if (indexedDB) {
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(indexedDB, 'matrix-js-sdk:crypto'));
    matrix_js_sdk_1.setCryptoStoreFactory(() => new matrix_js_sdk_1.LocalStorageCryptoStore(global.localStorage));
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(null));
}
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
class BleveHttp {
    constructor(baseUrl) {
        this.request = request.defaults({
            baseUrl,
        });
    }
    async search() {
    }
    async index(events) {
        return await this.request({
            url: 'index',
            method: 'PUT',
            json: true,
            body: events.map(ev => ev.event),
        }).then(resp => {
            // if resp is not successful return a failure
            return Promise.reject('');
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
    store: {
        type: 'sql',
        dialect: 'sqlite',
        path: './queue'
    },
    filter: (event, cb) => {
        if (event.getType() !== 'm.room.message')
            return cb(null, event);
        return cb('not m.room.message');
    }
});
setup().then().catch();
function intersect(a, b) {
    return new Set([...a].filter(x => b.has(x)));
}
class Filter {
    constructor(o) {
        if ('rooms' in o)
            this.rooms = new Set(o['rooms']);
        if ('not_rooms' in o)
            this.notRooms = new Set(o['not_rooms']);
        if ('senders' in o)
            this.senders = new Set(o['senders']);
        if ('not_senders' in o)
            this.notSenders = new Set(o['not_senders']);
        if ('types' in o)
            this.types = new Set(o['types']);
        if ('not_types' in o)
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
    constructor(Token, Group, GroupKey) {
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
    toString() {
        return JSON.stringify({
            Token: this.Token,
            Group: this.Group,
            GroupKey: this.GroupKey,
        });
    }
}
class Search {
    constructor(cli) {
        this.cli = cli;
    }
    Query(keys, searchFilter, roomIDsSet, orderBy, searchTerm, from, context) {
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
    const cli = matrix_js_sdk_1.createClient(Object.assign({ baseUrl: 'https://matrix.org', idBaseUrl: '' }, creds, { 
        // userId: '@webdevguru:matrix.org',
        // accessToken: 'MDAxOGxvY2F0aW9uIG1hdHJpeC5vcmcKMDAxM2lkZW50aWZpZXIga2V5CjAwMTBjaWQgZ2VuID0gMQowMDI5Y2lkIHVzZXJfaWQgPSBAd2ViZGV2Z3VydTptYXRyaXgub3JnCjAwMTZjaWQgdHlwZSA9IGFjY2VzcwowMDIxY2lkIG5vbmNlID0gLlhXVmh5RmZlMFFvQStWagowMDJmc2lnbmF0dXJlII5wMRc3oQpfpot5KJVTm49iORiVXMSl3aUfD4eLV2-6Cg',
        // deviceId: 'IWRTHSJSIC',
        useAuthorizationHeader: true, 
        // sessionStore: new LevelStore(),
        sessionStore: new matrix_js_sdk_1.WebStorageSessionStore(global.localStorage) }));
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
    await cli.initCrypto();
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
    app.post('/search', (req, res) => {
        let nextBatch;
        if (req.query['next_batch']) {
            const decoded = global.atob(req.query['next_batch']);
            try {
                nextBatch = JSON.parse(decoded);
                console.info("Found next batch of", nextBatch);
            }
            catch (e) {
                console.error("Failed to parse next_batch argument");
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
            const roomIds = joinedRooms.map((room) => room.room_id);
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
            let roomIdsSet = searchFilter.filterRooms(roomIds);
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
            switch (roomCat['orderBy']) {
                case 'rank':
                case '':
                    // get messages from Bleve by rank // resolve them locally
                    search.Query(keys, searchFilter, roomIdsSet, SearchOrder.Rank, searchTerm, 0, eventContext);
                    break;
                case 'recent':
                    // TODO get next back here
                    search.Query(keys, searchFilter, roomIdsSet, SearchOrder.Recent, searchTerm, nextBatch.from(), eventContext);
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
