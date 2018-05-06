import {RequestPromise, RequestPromiseOptions} from "request-promise";

import cors from 'cors';
import { Request, Response } from "express";

export interface Global {
    Olm: any
    localStorage?: any
    atob: (string) => string;
}

declare var global: Global;

global.Olm = require('olm');
import {
    createClient,
    WebStorageSessionStore,
    setCryptoStoreFactory,
    IndexedDBCryptoStore,
    LocalStorageCryptoStore,
} from 'matrix-js-sdk';
// import StubStore from 'matrix-js-sdk/src/store/stub.js';

// import * as LevelStore from './level-store';
// import * as Promise from 'bluebird';

// Loading localStorage module
if (typeof global.localStorage === "undefined" || global.localStorage === null) {
    global.localStorage = new (require('node-localstorage').LocalStorage)('./store');
}

const sqlite3 = require('sqlite3');
const indexeddbjs = require('indexeddb-js');

import * as request from 'request-promise';
import {RequestAPI, RequiredUriUrl} from "request";
import {Group, MatrixClient, MatrixEvent, requestFunction, Room} from "./typings/matrix-js-sdk";

// const request = require('request-promise');

const Queue = require('better-queue');

const engine = new sqlite3.Database('./store.sqlite');
const scope = indexeddbjs.makeScope('sqlite3', engine);
const indexedDB = scope.indexedDB;

if (indexedDB) {
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(indexedDB, 'matrix-js-sdk:crypto'));
    setCryptoStoreFactory(() => new LocalStorageCryptoStore(global.localStorage));
    // setCryptoStoreFactory(() => new IndexedDBCryptoStore(null));
}

import express from 'express';
import bodyParser from 'body-parser';
import {type} from "os";

class BleveHttp {
    request: RequestAPI<RequestPromise, RequestPromiseOptions, RequiredUriUrl>;

    constructor(baseUrl: string) {
        this.request = request.defaults({
            baseUrl,
        });
    }

    async search() {

    }

    async index(events: MatrixEvent[]) {
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

const q = new Queue((batch: MatrixEvent[], cb) => {
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
    filter: (event: MatrixEvent, cb) => {
        if (event.getType() !== 'm.room.message') return cb(null, event);
        return cb('not m.room.message');
    }
});

setup().then().catch();

function intersect(a: Set<string>, b: Set<string>): Set<string> {
    return new Set([...a].filter(x => b.has(x)));
}

class Filter {
    rooms: Set<string> | undefined;
    notRooms: Set<string> | undefined;
    senders: Set<string> | undefined;
    notSenders: Set<string> | undefined;
    types: Set<string> | undefined;
    notTypes: Set<string> | undefined;
    limit: number;
    containsURL: boolean | undefined;

    constructor(o: object) {
        if ('rooms' in o)
            this.rooms = new Set<string>(o['rooms']);
        if ('not_rooms' in o)
            this.notRooms = new Set<string>(o['not_rooms']);
        if ('senders' in o)
            this.senders = new Set<string>(o['senders']);
        if ('not_senders' in o)
            this.notSenders = new Set<string>(o['not_senders']);
        if ('types' in o)
            this.types = new Set<string>(o['types']);
        if ('not_types' in o)
            this.notTypes = new Set<string>(o['not_types']);

        this.limit = typeof o['limit'] === "number" ? o['limit'] : 10;
        this.containsURL = o['contains_url'];
    }

    filterRooms(roomIds: Array<string>): Set<string> {
        let roomIdsSet = new Set<string>(roomIds);

        if (this.notRooms)
            this.notRooms.forEach(notRoom => roomIdsSet.delete(notRoom))
        if (this.rooms)
            roomIdsSet = intersect(roomIdsSet, this.rooms);

        return roomIdsSet;
    }
}

class Result {
    public rank: number;
    public event: MatrixEvent;

    constructor(event: MatrixEvent, rank: number) {
        this.event = event;
        this.rank = rank;
    }
}

class GroupValue {
    public order: number|undefined;
    public nextBatch: string;
    public results: Array<string>;

    constructor() {
        this.order = undefined;
        this.nextBatch = "";
        this.results = [];
    }

    add(eventId: string, order: number) {
        if (this.order === undefined) this.order = order;
        this.results.push(eventId);
    }
}

class Batch {
    public Token: number;
    public Group: string;
    public GroupKey: string;

    constructor(Token: number, Group: string, GroupKey: string) {
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

    toString() {
        return JSON.stringify({
            Token: this.Token,
            Group: this.Group,
            GroupKey: this.GroupKey,
        });
    }
}

class Search {
    cli: MatrixClient;

    constructor(cli: MatrixClient) {
        this.cli = cli;
    }

    Query(keys: Array<string>, searchFilter: Filter, roomIDsSet: Set<string>, orderBy: SearchOrder, searchTerm: string, from: number, context: boolean) {

    }
}

enum SearchOrder {
    Rank = 'rank',
    Recent = 'recent',
}

async function setup() {
    let creds = {
        userId: global.localStorage.getItem('userId'),
        deviceId: global.localStorage.getItem('deviceId'),
        accessToken: global.localStorage.getItem('accessToken'),
    };

    if (!creds.userId || !creds.deviceId || !creds.accessToken) {
        const loginClient = createClient({
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
        } catch (err) {
            console.log('An error occured logging in!');
            console.log(err);
            process.exit(1);
        }
    }

    const cli = createClient({
        baseUrl: 'https://matrix.org',
        idBaseUrl: '',
        ...creds,
        // userId: '@webdevguru:matrix.org',
        // accessToken: 'MDAxOGxvY2F0aW9uIG1hdHJpeC5vcmcKMDAxM2lkZW50aWZpZXIga2V5CjAwMTBjaWQgZ2VuID0gMQowMDI5Y2lkIHVzZXJfaWQgPSBAd2ViZGV2Z3VydTptYXRyaXgub3JnCjAwMTZjaWQgdHlwZSA9IGFjY2VzcwowMDIxY2lkIG5vbmNlID0gLlhXVmh5RmZlMFFvQStWagowMDJmc2lnbmF0dXJlII5wMRc3oQpfpot5KJVTm49iORiVXMSl3aUfD4eLV2-6Cg',
        // deviceId: 'IWRTHSJSIC',
        useAuthorizationHeader: true,
        // sessionStore: new LevelStore(),
        sessionStore: new WebStorageSessionStore(global.localStorage),
    });

    cli.on('event', (event: MatrixEvent) => {
        if (event.isEncrypted()) return;
        return q.push(event);
    });
    cli.on('Event.decrypted', (event: MatrixEvent) => {
        if (event.isDecryptionFailure()) {
            console.warn(event);
            return;
        }
        return q.push(event);
    });

    await cli.initCrypto();
    cli.startClient();

    const app = express();

    app.use(bodyParser.json());


    app.use(cors({
        'allowedHeaders': ['access_token', 'Content-Type'],
        'exposedHeaders': ['access_token'],
        'origin': '*',
        'methods': 'POST',
        'preflightContinue': false
    }));

    app.post('/search', (req: Request, res: Response) => {
        let nextBatch;
        if (req.query['next_batch']) {
            const decoded = global.atob(req.query['next_batch']);
            try {
                nextBatch = JSON.parse(decoded);
                console.info("Found next batch of", nextBatch);
            } catch (e) {
                console.error("Failed to parse next_batch argument");
            }
        }

        // verify that user is allowed to access this thing
        try {
            const roomCat = req.body['search_categories']['room_events'];

            let keys = ['content.body', 'content.name', 'content.topic'];
            if ('keys' in roomCat && roomCat.keys.length) keys = roomCat.keys

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

            let highlights: Array<string> = [];

            const searchFilter = new Filter(roomCat.filter);

            const joinedRooms = cli.getRooms();
            const roomIds = joinedRooms.map((room: Room) => room.room_id);

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
            const roomGroups = new Map<string, GroupValue>();
            const senderGroups = new Map<string, GroupValue>();

            let globalNextBatch: string|null = null;
            let count: number = 0;

            let allowedEvents: Array<string> = [];
            const eventMap = new Map<string, Result>();

            const rooms = new Set<string>();

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

            allowedEvents.forEach((evId: string) => {
                const res = eventMap[evId];
                const ev = res.event;

                if (groupByRoomId) {
                    let v = roomGroups.get(ev.getRoomId());
                    if (!v) v = new GroupValue();
                    v.add(ev.getId(), res.order);
                    roomGroups.set(ev.getRoomId(), v);
                }
                if (groupBySender) {
                    let v = senderGroups.get(ev.getSender());
                    if (!v) v = new GroupValue();
                    v.add(ev.getId(), res.order);
                    senderGroups.set(ev.getSender(), v);
                }

                rooms.add(ev.getRoomId());
            });

            // TODO highlights calculation must remain on bleve side

            const roomStateMap = new Map<string, Array<MatrixEvent>>();
            if (includeState) {
                // TODO fetch state from server using API
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

            const results: Array<MatrixEvent> = allowedEvents.map((eventId: string) => eventMap[eventId].event);

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
                resp.search_categories.room_events['groups'] = new Map<string, Map<string, GroupValue>>();

            if (groupByRoomId) resp.search_categories.room_events['groups']['room_id'] = roomGroups;
            if (groupBySender) resp.search_categories.room_events['groups']['sender'] = senderGroups;

            res.json(resp);

        } catch (e) {
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
