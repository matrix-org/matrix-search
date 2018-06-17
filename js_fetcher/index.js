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
// import cors from 'cors';
const lodash_get_1 = __importDefault(require("lodash.get"));
const winston = __importStar(require("winston"));
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
}
const b = new BleveHttp("http://localhost:8000/api/");
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
 */ /*
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
            ephemeral: FILTER_BLOCK,
            account_data: FILTER_BLOCK,
        },
        presence: FILTER_BLOCK,
        account_data: FILTER_BLOCK,
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
function filterName(cli) {
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
var RequestKey;
(function (RequestKey) {
    RequestKey["body"] = "content.body";
    RequestKey["name"] = "content.name";
    RequestKey["topic"] = "content.topic";
})(RequestKey || (RequestKey = {}));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFNQSxnREFBd0I7QUFDeEIsMkJBQTJCO0FBQzNCLDREQUE2QjtBQUM3QixpREFBbUM7QUFDbkMsK0NBQWlDO0FBT2pDLDBEQUEwRDtBQUMxRCxNQUFNLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUU1QixpREFnQnVCO0FBQ3ZCLDZDQUE2QztBQUM3QywrQkFBNkI7QUFDN0IsNkNBQTZDO0FBQzdDLHlCQUF1QjtBQUV2QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDdEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUM7QUFDbkQsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFFM0MsTUFBTSx1QkFBdUIsR0FBRyxPQUFPLENBQUMsMERBQTBELENBQUMsQ0FBQyxPQUFPLENBQUM7QUFFNUcsZ0RBQWdEO0FBQ2hELE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdkIsOEJBQThCO0FBQzlCLElBQUksT0FBTyxNQUFNLENBQUMsWUFBWSxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsWUFBWSxLQUFLLElBQUk7SUFDMUUsTUFBTSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUVsRyxxQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLHVCQUF1QixDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBRTlFLGNBQUksQ0FBQyxNQUFNLENBQUM7SUFDUjtRQUNJLElBQUksRUFBRSxLQUFLO1FBQ1gsSUFBSSxFQUFFLFFBQVE7UUFDZCxXQUFXLEVBQUUs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QUNyQixtQ0FBcUIsQ0FBQTtJQUNyQixxQ0FBdUIsQ0FBQTtBQUMzQixDQUFDLEVBSkksVUFBVSxLQUFWLFVBQVUsUUFJZDtBQUVELE1BQU0sYUFBYSxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUUzRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHIiwic291cmNlc0NvbnRlbnQiOlsiZGVjbGFyZSB2YXIgZ2xvYmFsOiB7XG4gICAgT2xtOiBhbnlcbiAgICBsb2NhbFN0b3JhZ2U/OiBhbnlcbiAgICBhdG9iOiAoc3RyaW5nKSA9PiBzdHJpbmc7XG59O1xuXG5pbXBvcnQgYXJndiBmcm9tICdhcmd2Jztcbi8vIGltcG9ydCBjb3JzIGZyb20gJ2NvcnMnO1xuaW1wb3J0IGdldCBmcm9tICdsb2Rhc2guZ2V0JztcbmltcG9ydCAqIGFzIHdpbnN0b24gZnJvbSAnd2luc3Rvbic7XG5pbXBvcnQgKiBhcyBta2RpcnAgZnJvbSAnbWtkaXJwJztcbi8vIGltcG9ydCBib2R5UGFyc2VyIGZyb20gJ2JvZHktcGFyc2VyJztcbi8vIGltcG9ydCBleHByZXNzLCB7UmVxdWVzdCwgUmVzcG9uc2V9IGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0IHtSZXF1ZXN0UHJvbWlzZSwgUmVxdWVzdFByb21pc2VPcHRpb25zfSBmcm9tICdyZXF1ZXN0LXByb21pc2UnO1xuXG5pbXBvcnQge1JlcXVlc3RBUEksIFJlcXVpcmVkVXJpVXJsfSBmcm9tIFwicmVxdWVzdFwiO1xuXG4vLyBpbXBvcnQgT2xtIGJlZm9yZSBpbXBvcnRpbmcganMtc2RrIHRvIHByZXZlbnQgaXQgY3J5aW5nXG5nbG9iYWwuT2xtID0gcmVxdWlyZSgnb2xtJyk7XG5cbmltcG9ydCB7XG4gICAgUm9vbSxcbiAgICBFdmVudCxcbiAgICBGaWx0ZXIsXG4gICAgTWF0cml4LFxuICAgIE1hdHJpeEV2ZW50LFxuICAgIFVzZXJQcm9maWxlLFxuICAgIGNyZWF0ZUNsaWVudCxcbiAgICBFdmVudENvbnRleHQsXG4gICAgTWF0cml4Q2xpZW50LFxuICAgIEluZGV4ZWREQlN0b3JlLFxuICAgIEV2ZW50V2l0aENvbnRleHQsXG4gICAgTWF0cml4SW5NZW1vcnlTdG9yZSxcbiAgICBJbmRleGVkREJDcnlwdG9TdG9yZSxcbiAgICBzZXRDcnlwdG9TdG9yZUZhY3RvcnksXG4gICAgV2ViU3RvcmFnZVNlc3Npb25TdG9yZSxcbn0gZnJvbSAnbWF0cml4LWpzLXNkayc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hdHJpeENsaWVudCBwcm90b3R5cGVcbmltcG9ydCAnLi9tYXRyaXhfY2xpZW50X2V4dCc7XG4vLyBzaWRlLWVmZmVjdCB1cGdyYWRlIE1hcCBhbmQgU2V0IHByb3RvdHlwZXNcbmltcG9ydCAnLi9idWlsdGluX2V4dCc7XG5cbmNvbnN0IFF1ZXVlID0gcmVxdWlyZSgnYmV0dGVyLXF1ZXVlJyk7XG5jb25zdCBTcWxpdGVTdG9yZSA9IHJlcXVpcmUoJ2JldHRlci1xdWV1ZS1zcWxpdGUnKTtcbmNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0LXByb21pc2UnKTtcblxuY29uc3QgTG9jYWxTdG9yYWdlQ3J5cHRvU3RvcmUgPSByZXF1aXJlKCdtYXRyaXgtanMtc2RrL2xpYi9jcnlwdG8vc3RvcmUvbG9jYWxTdG9yYWdlLWNyeXB0by1zdG9yZScpLmRlZmF1bHQ7XG5cbi8vIGNyZWF0ZSBkaXJlY3Rvcnkgd2hpY2ggd2lsbCBob3VzZSB0aGUgc3RvcmVzLlxubWtkaXJwLnN5bmMoJy4vc3RvcmUnKTtcbi8vIExvYWRpbmcgbG9jYWxTdG9yYWdlIG1vZHVsZVxuaWYgKHR5cGVvZiBnbG9iYWwubG9jYWxTdG9yYWdlID09PSBcInVuZGVmaW5lZFwiIHx8IGdsb2JhbC5sb2NhbFN0b3JhZ2UgPT09IG51bGwpXG4gICAgZ2xvYmFsLmxvY2FsU3RvcmFnZSA9IG5ldyAocmVxdWlyZSgnbm9kZS1sb2NhbHN0b3JhZ2UnKS5Mb2NhbFN0b3JhZ2UpKCcuL3N0b3JlL2xvY2FsU3RvcmFnZScpO1xuXG5zZXRDcnlwdG9TdG9yZUZhY3RvcnkoKCkgPT4gbmV3IExvY2FsU3RvcmFnZUNyeXB0b1N0b3JlKGdsb2JhbC5sb2NhbFN0b3JhZ2UpKTtcblxuYXJndi5vcHRpb24oW1xuICAgIHtcbiAgICAgICAgbmFtZTogJ3VybCcsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSBVUkwgdG8gYmUgdXNlZCB0byBjb25uZWN0IHRvIHRoZSBNYXRyaXggSFMnLFxuICAgIH0sIHtcbiAgICAgICAgbmFtZTogJ3VzZXJuYW1lJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGhlIHVzZXJuYW1lIHRvIGJlIHVzZWQgdG8gY29ubmVjdCB0byB0aGUgTWF0cml4IEhTJyxcbiAgICB9LCB7XG4gICAgICAgIG5hbWU6ICdwYXNzd29yZCcsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSBwYXNzd29yZCB0byBiZSB1c2VkIHRvIGNvbm5lY3QgdG8gdGhlIE1hdHJpeCBIUycsXG4gICAgfSwge1xuICAgICAgICBuYW1lOiAncG9ydCcsXG4gICAgICAgIHR5cGU6ICdpbnQnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1BvcnQgdG8gYmluZCB0byAoZGVmYXVsdCA4MDAwKScsXG4gICAgfVxuXSk7XG5cbmNvbnN0IGxvZ2dlciA9IG5ldyB3aW5zdG9uLkxvZ2dlcih7XG4gICAgbGV2ZWw6ICdpbmZvJyxcbiAgICB0cmFuc3BvcnRzOiBbXG4gICAgICAgIG5ldyB3aW5zdG9uLnRyYW5zcG9ydHMuQ29uc29sZSh7Y29sb3JpemU6IHRydWV9KVxuICAgIF1cbn0pO1xuXG5jbGFzcyBCbGV2ZUh0dHAge1xuICAgIHJlcXVlc3Q6IFJlcXVlc3RBUEk8UmVxdWVzdFByb21pc2UsIFJlcXVlc3RQcm9taXNlT3B0aW9ucywgUmVxdWlyZWRVcmlVcmw+O1xuXG4gICAgY29uc3RydWN0b3IoYmFzZVVybDogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMucmVxdWVzdCA9IHJlcXVlc3QuZGVmYXVsdHMoe2Jhc2VVcmx9KTtcbiAgICB9XG5cbiAgICBlbnF1ZXVlKGV2ZW50czogQXJyYXk8RXZlbnQ+KSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAnZW5xdWV1ZScsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGpzb246IHRydWUsXG4gICAgICAgICAgICBib2R5OiBldmVudHMsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qXG4gICAgc2VhcmNoKHJlcTogQmxldmVSZXF1ZXN0KSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgdXJsOiAncXVlcnknLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBqc29uOiB0cnVlLFxuICAgICAgICAgICAgYm9keTogcmVxLFxuICAgICAgICB9KTtcbiAgICB9Ki9cbn1cblxuY29uc3QgYiA9IG5ldyBCbGV2ZUh0dHAoXCJodHRwOi8vbG9jYWxob3N0OjgwMDAvYXBpL1wiKTtcblxuZnVuY3Rpb24gaW5kZXhhYmxlKGV2OiBFdmVudCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbmRleGFibGVLZXlzLnNvbWUoKGtleTogc3RyaW5nKSA9PiBnZXQoZXYsIGtleSkgIT09IHVuZGVmaW5lZCk7XG59XG5cbmNvbnN0IHEgPSBuZXcgUXVldWUoYXN5bmMgKGJhdGNoOiBBcnJheTxFdmVudD4sIGNiKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY2IobnVsbCwgYXdhaXQgYi5lbnF1ZXVlKGJhdGNoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYihlKTtcbiAgICB9XG59LCB7XG4gICAgYmF0Y2hTaXplOiAxMDAsXG4gICAgbWF4UmV0cmllczogMTAwLFxuICAgIHJldHJ5RGVsYXk6IDUwMDAsXG4gICAgc3RvcmU6IG5ldyBTcWxpdGVTdG9yZSh7XG4gICAgICAgIHBhdGg6ICcuL3N0b3JlL3F1ZXVlLnNxbGl0ZScsXG4gICAgfSksXG59KTtcblxucS5vbigndGFza19xdWV1ZWQnLCBmdW5jdGlvbih0YXNrX2lkOiBzdHJpbmcsIGV2OiBFdmVudCkge1xuICAgIGNvbnN0IHtyb29tX2lkLCBldmVudF9pZCwgc2VuZGVyLCB0eXBlfSA9IGV2O1xuICAgIGlmIChldi5yZWRhY3RzKSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdlbnF1ZXVlIGV2ZW50IGZvciByZWRhY3Rpb24nLCB7cm9vbV9pZCwgZXZlbnRfaWQsIHRhc2tfaWR9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuaW5mbygnZW5xdWV1ZSBldmVudCBmb3IgaW5kZXhpbmcnLCB7cm9vbV9pZCwgZXZlbnRfaWQsIHNlbmRlciwgdHlwZSwgdGFza19pZH0pO1xuICAgIH1cbn0pO1xuXG5xLm9uKCdiYXRjaF9mYWlsZWQnLCBmdW5jdGlvbihlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignYmF0Y2ggZmFpbGVkJywge2Vycm9yfSk7XG59KTtcblxuc2V0dXAoKS50aGVuKCk7XG5cbi8vIGRlYnVnIGRpc2FibGUganMtc2RrIGxvZyBzcGFtXG5jb25zdCBkaXNhYmxlQ29uc29sZUxvZ2dlciA9IGZhbHNlO1xuaWYgKGRpc2FibGVDb25zb2xlTG9nZ2VyKSB7XG4gICAgY29uc29sZS5sb2cgPSBmdW5jdGlvbigpe307XG4gICAgY29uc29sZS53YXJuID0gZnVuY3Rpb24oKXt9O1xuICAgIGNvbnNvbGUuZXJyb3IgPSBmdW5jdGlvbigpe307XG4gICAgY29uc29sZS5lcnJvciA9IGZ1bmN0aW9uKCl7fTtcbn1cblxuLyppbnRlcmZhY2UgR3JvdXBWYWx1ZUpTT04ge1xuICAgIG9yZGVyOiBudW1iZXI7XG4gICAgbmV4dF9iYXRjaD86IHN0cmluZztcbiAgICByZXN1bHRzOiBBcnJheTxzdHJpbmc+O1xufVxuXG5jbGFzcyBHcm91cFZhbHVlIHtcbiAgICBwdWJsaWMgb3JkZXI6IG51bWJlcjtcbiAgICBwdWJsaWMgbmV4dF9iYXRjaDogc3RyaW5nO1xuICAgIHB1YmxpYyByZXN1bHRzOiBBcnJheTxzdHJpbmc+O1xuXG4gICAgY29uc3RydWN0b3Iob3JkZXI6IG51bWJlcikge1xuICAgICAgICB0aGlzLm9yZGVyID0gb3JkZXI7XG4gICAgICAgIHRoaXMubmV4dF9iYXRjaCA9IFwiXCI7XG4gICAgICAgIHRoaXMucmVzdWx0cyA9IFtdO1xuICAgIH1cblxuICAgIGFkZChldmVudElkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5yZXN1bHRzLnB1c2goZXZlbnRJZCk7XG4gICAgfVxuXG4gICAgLy8gZG9uJ3Qgc2VuZCBuZXh0X2JhdGNoIGlmIGl0IGlzIGVtcHR5XG4gICAgdG9KU09OKCk6IEdyb3VwVmFsdWVKU09OIHtcbiAgICAgICAgY29uc3QgbzogR3JvdXBWYWx1ZUpTT04gPSB7XG4gICAgICAgICAgICBvcmRlcjogdGhpcy5vcmRlcixcbiAgICAgICAgICAgIHJlc3VsdHM6IHRoaXMucmVzdWx0cyxcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHRoaXMubmV4dF9iYXRjaCkgby5uZXh0X2JhdGNoID0gdGhpcy5uZXh0X2JhdGNoO1xuICAgICAgICByZXR1cm4gbztcbiAgICB9XG59XG5cbmNsYXNzIEJhdGNoIHtcbiAgICBwdWJsaWMgVG9rZW46IG51bWJlcjtcbiAgICBwdWJsaWMgR3JvdXA6IHN0cmluZztcbiAgICBwdWJsaWMgR3JvdXBLZXk6IHN0cmluZztcblxuICAgIGNvbnN0cnVjdG9yKFRva2VuOiBudW1iZXIgPSAwLCBHcm91cDogc3RyaW5nLCBHcm91cEtleTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuVG9rZW4gPSBUb2tlbjtcbiAgICAgICAgdGhpcy5Hcm91cCA9IEdyb3VwO1xuICAgICAgICB0aGlzLkdyb3VwS2V5ID0gR3JvdXBLZXk7XG4gICAgfVxuXG4gICAgc3RhdGljIGZyb21TdHJpbmcoZnJvbTogc3RyaW5nKTogQmF0Y2ggfCB1bmRlZmluZWQge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgbyA9IEpTT04ucGFyc2UoZnJvbSk7XG4gICAgICAgICAgICAvLyBjb25zdCBiID0gbmV3IEJhdGNoKG8pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnJvbSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuVG9rZW47XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBUb2tlbjogdGhpcy5Ub2tlbixcbiAgICAgICAgICAgIEdyb3VwOiB0aGlzLkdyb3VwLFxuICAgICAgICAgICAgR3JvdXBLZXk6IHRoaXMuR3JvdXBLZXksXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuaW50ZXJmYWNlIFF1ZXJ5IHtcbiAgICBtdXN0PzogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICAgIHNob3VsZD86IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PjtcbiAgICBtdXN0Tm90PzogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xufVxuXG5pbnRlcmZhY2UgQmxldmVSZXF1ZXN0IHtcbiAgICBrZXlzOiBBcnJheTxzdHJpbmc+O1xuICAgIGZpbHRlcjogUXVlcnk7XG4gICAgc29ydEJ5OiBTZWFyY2hPcmRlcjtcbiAgICBzZWFyY2hUZXJtOiBzdHJpbmc7XG4gICAgZnJvbTogbnVtYmVyO1xuICAgIHNpemU6IG51bWJlcjtcbn1cblxuY29uc3QgcGFnZVNpemUgPSAxMDtcblxuaW50ZXJmYWNlIEJsZXZlUmVzcG9uc2VSb3cge1xuICAgIHJvb21JZDogc3RyaW5nO1xuICAgIGV2ZW50SWQ6IHN0cmluZztcbiAgICBzY29yZTogbnVtYmVyO1xuICAgIGhpZ2hsaWdodHM6IFNldDxzdHJpbmc+O1xufVxuXG5pbnRlcmZhY2UgQmxldmVSZXNwb25zZSB7XG4gICAgcm93czogQXJyYXk8QmxldmVSZXNwb25zZVJvdz47XG4gICAgdG90YWw6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIEV2ZW50TG9va3VwUmVzdWx0IHtcbiAgICBldmVudDogTWF0cml4RXZlbnQ7XG4gICAgc2NvcmU6IG51bWJlcjtcbiAgICBzdGF0ZT86IEFycmF5PE1hdHJpeEV2ZW50PjtcbiAgICBjb250ZXh0PzogRXZlbnRDb250ZXh0O1xuICAgIGhpZ2hsaWdodHM6IFNldDxzdHJpbmc+O1xufVxuXG5pbnRlcmZhY2UgUmVzdWx0IHtcbiAgICByYW5rOiBudW1iZXI7XG4gICAgcmVzdWx0OiBFdmVudDtcbiAgICBjb250ZXh0PzogRXZlbnRDb250ZXh0O1xufSovXG5cbi8qY2xhc3MgU2VhcmNoIHtcbiAgICBjbGk6IE1hdHJpeENsaWVudDtcblxuICAgIGNvbnN0cnVjdG9yKGNsaTogTWF0cml4Q2xpZW50KSB7XG4gICAgICAgIHRoaXMuY2xpID0gY2xpO1xuICAgIH1cblxuICAgIC8vIGltcGVkYW5jZSBtYXRjaGluZy5cbiAgICBhc3luYyByZXNvbHZlT25lKHJvb21JZDogc3RyaW5nLCBldmVudElkOiBzdHJpbmcsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbRXZlbnQsIEV2ZW50Q29udGV4dHx1bmRlZmluZWRdPiB7XG4gICAgICAgIGlmIChjb250ZXh0KSB7XG4gICAgICAgICAgICBjb25zdCBsaW1pdCA9IE1hdGgubWF4KGNvbnRleHQuYWZ0ZXJfbGltaXQgfHwgMCwgY29udGV4dC5iZWZvcmVfbGltaXQgfHwgMCwgMyk7XG4gICAgICAgICAgICBjb25zdCBldmMgPSBhd2FpdCB0aGlzLmNsaS5mZXRjaEV2ZW50Q29udGV4dChyb29tSWQsIGV2ZW50SWQsIGxpbWl0KTtcblxuICAgICAgICAgICAgY29uc3Qge3N0YXJ0LCBlbmQsIGV2ZW50c19iZWZvcmUsIGV2ZW50c19hZnRlciwgc3RhdGV9ID0gZXZjLmNvbnRleHQ7XG4gICAgICAgICAgICBjb25zdCBjdHg6IEV2ZW50Q29udGV4dCA9IHtcbiAgICAgICAgICAgICAgICBzdGFydCxcbiAgICAgICAgICAgICAgICBlbmQsXG4gICAgICAgICAgICAgICAgcHJvZmlsZV9pbmZvOiBuZXcgTWFwPHN0cmluZywgVXNlclByb2ZpbGU+KCksXG4gICAgICAgICAgICAgICAgZXZlbnRzX2JlZm9yZTogZXZlbnRzX2JlZm9yZS5tYXAoKGV2OiBNYXRyaXhFdmVudCkgPT4gZXYuZXZlbnQpLFxuICAgICAgICAgICAgICAgIGV2ZW50c19hZnRlcjogZXZlbnRzX2FmdGVyLm1hcCgoZXY6IE1hdHJpeEV2ZW50KSA9PiBldi5ldmVudCksXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCB1c2VycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICAgICAgWy4uLmV2ZW50c19iZWZvcmUsIGV2Yy5ldmVudCwgLi4uZXZlbnRzX2FmdGVyXS5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICB1c2Vycy5hZGQoZXYuZ2V0U2VuZGVyKCkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHN0YXRlLmZvckVhY2goKGV2OiBFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChldi50eXBlID09PSAnbS5yb29tLm1lbWJlcicgJiYgdXNlcnMuaGFzKGV2LnN0YXRlX2tleSkpXG4gICAgICAgICAgICAgICAgICAgIGN0eC5wcm9maWxlX2luZm8uc2V0KGV2LnN0YXRlX2tleSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGxheW5hbWU6IGV2LmNvbnRlbnRbJ2Rpc3BsYXluYW1lJ10sXG4gICAgICAgICAgICAgICAgICAgICAgICBhdmF0YXJfdXJsOiBldi5jb250ZW50WydhdmF0YXJfdXJsJ10sXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiBbZXZjLmV2ZW50LCBjdHhdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLmNsaS5mZXRjaEV2ZW50KHJvb21JZCwgZXZlbnRJZCksIHVuZGVmaW5lZF07XG4gICAgfVxuXG4gICAgYXN5bmMgcmVzb2x2ZShyb3dzOiBBcnJheTxCbGV2ZVJlc3BvbnNlUm93PiwgY29udGV4dD86IFJlcXVlc3RFdmVudENvbnRleHQpOiBQcm9taXNlPEFycmF5PEV2ZW50TG9va3VwUmVzdWx0Pj4ge1xuICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTxFdmVudExvb2t1cFJlc3VsdD4gPSBbXTtcblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbDx2b2lkPihyb3dzLm1hcChhc3luYyAocm93OiBCbGV2ZVJlc3BvbnNlUm93KTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtldiwgY3R4XSA9IGF3YWl0IHRoaXMucmVzb2x2ZU9uZShyb3cucm9vbUlkLCByb3cuZXZlbnRJZCwgY29udGV4dCk7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQ6IGV2LFxuICAgICAgICAgICAgICAgICAgICBjb250ZXh0OiBjdHgsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiByb3cuc2NvcmUsXG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IHJvdy5oaWdobGlnaHRzLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge31cbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH0qL1xuXG4gICAgLyoqXG4gICAgICogQHBhcmFtIGtleXMge3N0cmluZ30gcGFzcyBzdHJhaWdodCB0aHJvdWdoIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIHNlYXJjaEZpbHRlciB7RmlsdGVyfSBjb21wdXRlIGFuZCBzZW5kIHF1ZXJ5IHJ1bGVzIHRvIGdvLWJsZXZlXG4gICAgICogQHBhcmFtIHNvcnRCeSB7U2VhcmNoT3JkZXJ9IHBhc3Mgc3RyYWlnaHQgdGhyb3VnaCB0byBnby1ibGV2ZVxuICAgICAqIEBwYXJhbSBzZWFyY2hUZXJtIHtzdHJpbmd9IHBhc3Mgc3RyYWlnaHQgdGhyb3VnaCB0byBnby1ibGV2ZVxuICAgICAqIEBwYXJhbSBmcm9tIHtudW1iZXJ9IHBhc3Mgc3RyYWlnaHQgdGhyb3VnaCB0byBnby1ibGV2ZVxuICAgICAqIEBwYXJhbSBjb250ZXh0PyB7UmVxdWVzdEV2ZW50Q29udGV4dH0gaWYgZGVmaW5lZCB1c2UgdG8gZmV0Y2ggY29udGV4dCBhZnRlciBnby1ibGV2ZSBjYWxsXG4gICAgICovLypcbiAgICBhc3luYyBxdWVyeShrZXlzOiBBcnJheTxzdHJpbmc+LCBzZWFyY2hGaWx0ZXI6IFNlYXJjaEZpbHRlciwgc29ydEJ5OiBTZWFyY2hPcmRlciwgc2VhcmNoVGVybTogc3RyaW5nLCBmcm9tOiBudW1iZXIsIGNvbnRleHQ/OiBSZXF1ZXN0RXZlbnRDb250ZXh0KTogUHJvbWlzZTxbQXJyYXk8RXZlbnRMb29rdXBSZXN1bHQ+LCBudW1iZXJdPiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcjogUXVlcnkgPSB7fTtcblxuICAgICAgICAvLyBpbml0aWFsaXplIGZpZWxkcyB3ZSB3aWxsIHVzZSAod2UgZG9uJ3QgdXNlIHNob3VsZCBjdXJyZW50bHkpXG4gICAgICAgIGZpbHRlci5tdXN0ID0gbmV3IE1hcCgpO1xuICAgICAgICBmaWx0ZXIubXVzdE5vdCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBtdXN0IHNhdGlzZnkgcm9vbV9pZFxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnJvb21zLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3Quc2V0KCdyb29tX2lkJywgc2VhcmNoRmlsdGVyLnJvb21zKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RSb29tcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0Tm90LnNldCgncm9vbV9pZCcsIHNlYXJjaEZpbHRlci5ub3RSb29tcyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHNlbmRlclxuICAgICAgICBpZiAoc2VhcmNoRmlsdGVyLnNlbmRlcnMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdC5zZXQoJ3NlbmRlcicsIHNlYXJjaEZpbHRlci5zZW5kZXJzKTtcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci5ub3RTZW5kZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgZmlsdGVyLm11c3ROb3Quc2V0KCdzZW5kZXInLCBzZWFyY2hGaWx0ZXIubm90U2VuZGVycyk7XG5cbiAgICAgICAgLy8gbXVzdCBzYXRpc2Z5IHR5cGVcbiAgICAgICAgaWYgKHNlYXJjaEZpbHRlci50eXBlcy5zaXplID4gMClcbiAgICAgICAgICAgIGZpbHRlci5tdXN0LnNldCgndHlwZScsIHNlYXJjaEZpbHRlci50eXBlcyk7XG4gICAgICAgIGlmIChzZWFyY2hGaWx0ZXIubm90VHlwZXMuc2l6ZSA+IDApXG4gICAgICAgICAgICBmaWx0ZXIubXVzdE5vdC5zZXQoJ3R5cGUnLCBzZWFyY2hGaWx0ZXIubm90VHlwZXMpO1xuXG4gICAgICAgIGNvbnN0IHI6IEJsZXZlUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGZyb20sXG4gICAgICAgICAgICBrZXlzLFxuICAgICAgICAgICAgZmlsdGVyLFxuICAgICAgICAgICAgc29ydEJ5LFxuICAgICAgICAgICAgc2VhcmNoVGVybSxcbiAgICAgICAgICAgIHNpemU6IHBhZ2VTaXplLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3A6IEJsZXZlUmVzcG9uc2UgPSBhd2FpdCBiLnNlYXJjaChyKTtcbiAgICAgICAgcmV0dXJuIFthd2FpdCB0aGlzLnJlc29sdmUocmVzcC5yb3dzLCBjb250ZXh0KSwgcmVzcC50b3RhbF07XG4gICAgfVxufVxuXG5lbnVtIFNlYXJjaE9yZGVyIHtcbiAgICBSYW5rID0gJ3JhbmsnLFxuICAgIFJlY2VudCA9ICdyZWNlbnQnLFxufSovXG5cbmNvbnN0IEZJTFRFUl9CTE9DSyA9IHtcbiAgICBub3RfdHlwZXM6IFsnKiddLFxuICAgIGxpbWl0OiAwLFxufTtcblxuYXN5bmMgZnVuY3Rpb24gc2V0dXAoKSB7XG4gICAgY29uc3QgYXJncyA9IGFyZ3YucnVuKCk7XG5cbiAgICBjb25zdCBiYXNlVXJsID0gYXJncy5vcHRpb25zWyd1cmwnXSB8fCAnaHR0cHM6Ly9tYXRyaXgub3JnJztcblxuICAgIGxldCBjcmVkcyA9IHtcbiAgICAgICAgdXNlcklkOiBnbG9iYWwubG9jYWxTdG9yYWdlLmdldEl0ZW0oJ3VzZXJJZCcpLFxuICAgICAgICBkZXZpY2VJZDogZ2xvYmFsLmxvY2FsU3RvcmFnZS5nZXRJdGVtKCdkZXZpY2VJZCcpLFxuICAgICAgICBhY2Nlc3NUb2tlbjogZ2xvYmFsLmxvY2FsU3RvcmFnZS5nZXRJdGVtKCdhY2Nlc3NUb2tlbicpLFxuICAgIH07XG5cbiAgICBpZiAoIWNyZWRzLnVzZXJJZCB8fCAhY3JlZHMuZGV2aWNlSWQgfHwgIWNyZWRzLmFjY2Vzc1Rva2VuKSB7XG4gICAgICAgIGlmICghYXJncy5vcHRpb25zWyd1c2VybmFtZSddIHx8ICFhcmdzLm9wdGlvbnNbJ3Bhc3N3b3JkJ10pIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcigndXNlcm5hbWUgYW5kIHBhc3N3b3JkIHdlcmUgbm90IHNwZWNpZmllZCBvbiB0aGUgY29tbWFuZGxpbmUgYW5kIG5vbmUgd2VyZSBzYXZlZCcpO1xuICAgICAgICAgICAgYXJndi5oZWxwKCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoLTEpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9naW5DbGllbnQ6IE1hdHJpeENsaWVudCA9IGNyZWF0ZUNsaWVudCh7YmFzZVVybH0pO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXMgPSBhd2FpdCBsb2dpbkNsaWVudC5sb2dpbignbS5sb2dpbi5wYXNzd29yZCcsIHtcbiAgICAgICAgICAgICAgICB1c2VyOiBhcmdzLm9wdGlvbnNbJ3VzZXJuYW1lJ10sXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQ6IGFyZ3Mub3B0aW9uc1sncGFzc3dvcmQnXSxcbiAgICAgICAgICAgICAgICBpbml0aWFsX2RldmljZV9kaXNwbGF5X25hbWU6ICdNYXRyaXggU2VhcmNoIERhZW1vbicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ2xvZ2dlZCBpbicsIHt1c2VyX2lkOiByZXMudXNlcl9pZH0pO1xuICAgICAgICAgICAgZ2xvYmFsLmxvY2FsU3RvcmFnZS5zZXRJdGVtKCd1c2VySWQnLCByZXMudXNlcl9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2RldmljZUlkJywgcmVzLmRldmljZV9pZCk7XG4gICAgICAgICAgICBnbG9iYWwubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2FjY2Vzc1Rva2VuJywgcmVzLmFjY2Vzc190b2tlbik7XG5cbiAgICAgICAgICAgIGNyZWRzID0ge1xuICAgICAgICAgICAgICAgIHVzZXJJZDogcmVzLnVzZXJfaWQsXG4gICAgICAgICAgICAgICAgZGV2aWNlSWQ6IHJlcy5kZXZpY2VfaWQsXG4gICAgICAgICAgICAgICAgYWNjZXNzVG9rZW46IHJlcy5hY2Nlc3NfdG9rZW4sXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKCdhbiBlcnJvciBvY2N1cnJlZCBsb2dnaW5nIGluJywge2Vycm9yfSk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGk6IE1hdHJpeENsaWVudCA9IGNyZWF0ZUNsaWVudCh7XG4gICAgICAgIGJhc2VVcmwsXG4gICAgICAgIGlkQmFzZVVybDogJycsXG4gICAgICAgIC4uLmNyZWRzLFxuICAgICAgICB1c2VBdXRob3JpemF0aW9uSGVhZGVyOiB0cnVlLFxuICAgICAgICBzdG9yZTogbmV3IE1hdHJpeEluTWVtb3J5U3RvcmUoe1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlOiBnbG9iYWwubG9jYWxTdG9yYWdlLFxuICAgICAgICB9KSxcbiAgICAgICAgc2Vzc2lvblN0b3JlOiBuZXcgV2ViU3RvcmFnZVNlc3Npb25TdG9yZShnbG9iYWwubG9jYWxTdG9yYWdlKSxcbiAgICB9KTtcblxuICAgIGNsaS5vbignZXZlbnQnLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5pc0VuY3J5cHRlZCgpKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgY2V2ID0gZXZlbnQuZ2V0Q2xlYXJFdmVudCgpO1xuICAgICAgICAvLyBpZiBldmVudCBjYW4gYmUgcmVkYWN0ZWQgb3IgaXMgYSByZWRhY3Rpb24gdGhlbiBlbnF1ZXVlIGl0IGZvciBwcm9jZXNzaW5nXG4gICAgICAgIGlmIChldmVudC5nZXRUeXBlKCkgPT09IFwibS5yb29tLnJlZGFjdGlvblwiIHx8ICFpbmRleGFibGUoY2V2KSkgcmV0dXJuO1xuICAgICAgICByZXR1cm4gcS5wdXNoKGNldik7XG4gICAgfSk7XG4gICAgY2xpLm9uKCdFdmVudC5kZWNyeXB0ZWQnLCAoZXZlbnQ6IE1hdHJpeEV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5pc0RlY3J5cHRpb25GYWlsdXJlKCkpIHtcbiAgICAgICAgICAgIGxvZ2dlci53YXJuKCdkZWNyeXB0aW9uIGZhaWx1cmUnLCB7ZXZlbnQ6IGV2ZW50LmV2ZW50fSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjZXYgPSBldmVudC5nZXRDbGVhckV2ZW50KCk7XG4gICAgICAgIGlmICghaW5kZXhhYmxlKGNldikpIHJldHVybjtcbiAgICAgICAgcmV0dXJuIHEucHVzaChjZXYpO1xuICAgIH0pO1xuXG4gICAgLy8gY2xpLm9uKCdSb29tLnJlZGFjdGlvbicsIChldmVudDogTWF0cml4RXZlbnQpID0+IHtcbiAgICAvLyAgICAgcmV0dXJuIHEucHVzaCh7XG4gICAgLy8gICAgICAgICB0eXBlOiBKb2JUeXBlLnJlZGFjdCxcbiAgICAvLyAgICAgICAgIGV2ZW50OiBldmVudC5nZXRDbGVhckV2ZW50KCksXG4gICAgLy8gICAgIH0pO1xuICAgIC8vIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ2luaXRpYWxpemluZyBjcnlwdG8nKTtcbiAgICAgICAgYXdhaXQgY2xpLmluaXRDcnlwdG8oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ2ZhaWxlZCB0byBpbml0IGNyeXB0bycsIHtlcnJvcn0pO1xuICAgICAgICBwcm9jZXNzLmV4aXQoLTEpO1xuICAgIH1cbiAgICBsb2dnZXIuaW5mbygnY3J5cHRvIGluaXRpYWxpemVkJyk7XG5cbiAgICAvLyBjcmVhdGUgc3luYyBmaWx0ZXJcbiAgICBjb25zdCBmaWx0ZXIgPSBuZXcgRmlsdGVyKGNsaS5jcmVkZW50aWFscy51c2VySWQpO1xuICAgIGZpbHRlci5zZXREZWZpbml0aW9uKHtcbiAgICAgICAgcm9vbToge1xuICAgICAgICAgICAgaW5jbHVkZV9sZWF2ZTogZmFsc2UsIC8vIFRPRE86IG5vdCBzdXJlIGhlcmVcbiAgICAgICAgICAgIGVwaGVtZXJhbDogRklMVEVSX0JMT0NLLCAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IGVwaGVtZXJhbCBldmVudHNcbiAgICAgICAgICAgIGFjY291bnRfZGF0YTogRklMVEVSX0JMT0NLLCAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IHJvb20gYWNjb3VudF9kYXRhXG4gICAgICAgICAgICAvLyBzdGF0ZTogRklMVEVSX0JMT0NLLCAvLyBUT0RPOiBkbyB3ZSBjYXJlIGFib3V0IHN0YXRlXG4gICAgICAgICAgICAvLyB0aW1lbGluZTogeyAvLyBUT0RPIGRvIHdlIHdhbnQgYWxsIHRpbWVsaW5lIGV2c1xuICAgICAgICAgICAgLy9cbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgfSxcbiAgICAgICAgcHJlc2VuY2U6IEZJTFRFUl9CTE9DSywgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCBwcmVzZW5jZVxuICAgICAgICBhY2NvdW50X2RhdGE6IEZJTFRFUl9CTE9DSywgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCBnbG9iYWwgYWNjb3VudF9kYXRhXG4gICAgfSk7XG5cbiAgICB0cnkge1xuICAgICAgICBsb2dnZXIuaW5mbygnbG9hZGluZy9jcmVhdGluZyBzeW5jIGZpbHRlcicpO1xuICAgICAgICBmaWx0ZXIuZmlsdGVySWQgPSBhd2FpdCBjbGkuZ2V0T3JDcmVhdGVGaWx0ZXIoZmlsdGVyTmFtZShjbGkpLCBmaWx0ZXIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignZmFpbGVkIHRvIGdldE9yQ3JlYXRlIHN5bmMgZmlsdGVyJywge2Vycm9yfSk7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gICAgfVxuICAgIGxvZ2dlci5pbmZvKCdzeW5jIGZpbHRlciBsb2FkZWQnLCB7ZmlsdGVyX2lkOiBmaWx0ZXIuZ2V0RmlsdGVySWQoKX0pO1xuXG4gICAgbG9nZ2VyLmluZm8oJ3N0YXJ0aW5nIGNsaWVudCcpO1xuICAgIC8vIGZpbHRlciBzeW5jIHRvIGltcHJvdmUgcGVyZm9ybWFuY2VcbiAgICBjbGkuc3RhcnRDbGllbnQoe1xuICAgICAgICBkaXNhYmxlUHJlc2VuY2U6IHRydWUsXG4gICAgICAgIGZpbHRlcixcbiAgICB9KTtcbiAgICBsb2dnZXIuaW5mbygnY2xpZW50IHN0YXJ0ZWQnKTtcblxuICAgIC8qXG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGFwcC51c2UoYm9keVBhcnNlci5qc29uKCkpO1xuICAgIGFwcC51c2UoY29ycyh7XG4gICAgICAgICdhbGxvd2VkSGVhZGVycyc6IFsnYWNjZXNzX3Rva2VuJywgJ0NvbnRlbnQtVHlwZSddLFxuICAgICAgICAnZXhwb3NlZEhlYWRlcnMnOiBbJ2FjY2Vzc190b2tlbiddLFxuICAgICAgICAnb3JpZ2luJzogJyonLFxuICAgICAgICAnbWV0aG9kcyc6ICdQT1NUJyxcbiAgICAgICAgJ3ByZWZsaWdodENvbnRpbnVlJzogZmFsc2VcbiAgICB9KSk7XG5cbiAgICBhcHAucG9zdCgnL3NlYXJjaCcsIGFzeW5jIChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFyZXEuYm9keSkge1xuICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNDAwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBuZXh0QmF0Y2g6IEJhdGNoIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGlmIChyZXEucXVlcnlbJ25leHRfYmF0Y2gnXSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBuZXh0QmF0Y2ggPSBKU09OLnBhcnNlKGdsb2JhbC5hdG9iKHJlcS5xdWVyeVsnbmV4dF9iYXRjaCddKSk7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ2ZvdW5kIG5leHQgYmF0Y2ggb2YnLCB7bmV4dF9iYXRjaDogbmV4dEJhdGNofSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcignZmFpbGVkIHRvIHBhcnNlIG5leHRfYmF0Y2ggYXJndW1lbnQnLCB7ZXJyb3J9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZlcmlmeSB0aGF0IHVzZXIgaXMgYWxsb3dlZCB0byBhY2Nlc3MgdGhpcyB0aGluZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY2FzdEJvZHk6IE1hdHJpeFNlYXJjaFJlcXVlc3QgPSByZXEuYm9keTtcbiAgICAgICAgICAgIGNvbnN0IHJvb21DYXQgPSBjYXN0Qm9keS5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cztcblxuICAgICAgICAgICAgaWYgKCFyb29tQ2F0KSB7XG4gICAgICAgICAgICAgICAgcmVzLnNlbmRTdGF0dXMoNTAxKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBrZXlzOiBBcnJheTxSZXF1ZXN0S2V5PiA9IFtSZXF1ZXN0S2V5LmJvZHksIFJlcXVlc3RLZXkubmFtZSwgUmVxdWVzdEtleS50b3BpY107IC8vIGRlZmF1bHQgdmFsdWUgZm9yIHJvb21DYXQua2V5XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5rZXlzICYmIHJvb21DYXQua2V5cy5sZW5ndGgpIGtleXMgPSByb29tQ2F0LmtleXM7XG5cbiAgICAgICAgICAgIGNvbnN0IGluY2x1ZGVTdGF0ZSA9IEJvb2xlYW4ocm9vbUNhdFsnaW5jbHVkZV9zdGF0ZSddKTtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50Q29udGV4dCA9IHJvb21DYXRbJ2V2ZW50X2NvbnRleHQnXTtcblxuICAgICAgICAgICAgbGV0IGdyb3VwQnlSb29tSWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxldCBncm91cEJ5U2VuZGVyID0gZmFsc2U7XG4gICAgICAgICAgICBpZiAocm9vbUNhdC5ncm91cGluZ3MgJiYgcm9vbUNhdC5ncm91cGluZ3MuZ3JvdXBfYnkpIHtcbiAgICAgICAgICAgICAgICByb29tQ2F0Lmdyb3VwaW5ncy5ncm91cF9ieS5mb3JFYWNoKGdyb3VwaW5nID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChncm91cGluZy5rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnJvb21JZDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5Um9vbUlkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgUmVxdWVzdEdyb3VwS2V5LnNlbmRlcjpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBncm91cEJ5U2VuZGVyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXIgPSBuZXcgU2VhcmNoRmlsdGVyKHJvb21DYXQuZmlsdGVyIHx8IHt9KTsgLy8gZGVmYXVsdCB0byBlbXB0eSBvYmplY3QgdG8gYXNzdW1lIGRlZmF1bHRzXG5cbiAgICAgICAgICAgIC8vIFRPRE8gdGhpcyBpcyByZW1vdmVkIGJlY2F1c2Ugcm9vbXMgc3RvcmUgaXMgdW5yZWxpYWJsZSBBRlxuICAgICAgICAgICAgLy8gY29uc3Qgam9pbmVkUm9vbXMgPSBjbGkuZ2V0Um9vbXMoKTtcbiAgICAgICAgICAgIC8vIGNvbnN0IHJvb21JZHMgPSBqb2luZWRSb29tcy5tYXAoKHJvb206IFJvb20pID0+IHJvb20ucm9vbUlkKTtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyBpZiAocm9vbUlkcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICAvLyAgICAgcmVzLmpzb24oe1xuICAgICAgICAgICAgLy8gICAgICAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgcm9vbV9ldmVudHM6IHtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBoaWdobGlnaHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICByZXN1bHRzOiBbXSxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgICBjb3VudDogMCxcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyAgICAgfSk7XG4gICAgICAgICAgICAvLyAgICAgcmV0dXJuO1xuICAgICAgICAgICAgLy8gfVxuXG4gICAgICAgICAgICAvLyBTS0lQIGZvciBub3dcbiAgICAgICAgICAgIC8vIGxldCByb29tSWRzU2V0ID0gc2VhcmNoRmlsdGVyLmZpbHRlclJvb21zKHJvb21JZHMpO1xuXG4gICAgICAgICAgICAvLyBpZiAoYi5pc0dyb3VwaW5nKFwicm9vbV9pZFwiKSkge1xuICAgICAgICAgICAgLy8gICAgIHJvb21JRHNTZXQuSW50ZXJzZWN0KGNvbW1vbi5OZXdTdHJpbmdTZXQoW11zdHJpbmd7KmIuR3JvdXBLZXl9KSlcbiAgICAgICAgICAgIC8vIH1cblxuICAgICAgICAgICAgLy8gVE9ETyBkbyB3ZSBuZWVkIHRoaXNcbiAgICAgICAgICAgIC8vcmFua01hcCA6PSBtYXBbc3RyaW5nXWZsb2F0NjR7fVxuICAgICAgICAgICAgLy9hbGxvd2VkRXZlbnRzIDo9IFtdKlJlc3VsdHt9XG4gICAgICAgICAgICAvLyBUT0RPIHRoZXNlIG5lZWQgY2hhbmdpbmdcbiAgICAgICAgICAgIGNvbnN0IHJvb21Hcm91cHMgPSBuZXcgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4oKTtcbiAgICAgICAgICAgIGNvbnN0IHNlbmRlckdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPigpO1xuXG4gICAgICAgICAgICBsZXQgZ2xvYmFsTmV4dEJhdGNoOiBzdHJpbmd8dW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBjb25zdCByb29tcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2ggPSBuZXcgU2VhcmNoKGNsaSk7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hUZXJtID0gcm9vbUNhdFsnc2VhcmNoX3Rlcm0nXTtcblxuICAgICAgICAgICAgbGV0IGFsbG93ZWRFdmVudHM6IEFycmF5PEV2ZW50TG9va3VwUmVzdWx0PjtcbiAgICAgICAgICAgIGxldCBjb3VudDogbnVtYmVyID0gMDtcblxuICAgICAgICAgICAgLy8gVE9ETyBleHRlbmQgbG9jYWwgZXZlbnQgbWFwIHVzaW5nIHNxbGl0ZS9sZXZlbGRiXG4gICAgICAgICAgICBzd2l0Y2ggKHJvb21DYXRbJ29yZGVyX2J5J10pIHtcbiAgICAgICAgICAgICAgICBjYXNlICdyYW5rJzpcbiAgICAgICAgICAgICAgICBjYXNlICcnOlxuICAgICAgICAgICAgICAgICAgICAvLyBnZXQgbWVzc2FnZXMgZnJvbSBCbGV2ZSBieSByYW5rIC8vIHJlc29sdmUgdGhlbSBsb2NhbGx5XG4gICAgICAgICAgICAgICAgICAgIFthbGxvd2VkRXZlbnRzLCBjb3VudF0gPSBhd2FpdCBzZWFyY2gucXVlcnkoa2V5cywgc2VhcmNoRmlsdGVyLCBTZWFyY2hPcmRlci5SYW5rLCBzZWFyY2hUZXJtLCAwLCBldmVudENvbnRleHQpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ3JlY2VudCc6XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSBuZXh0QmF0Y2ggIT09IG51bGwgPyBuZXh0QmF0Y2guZnJvbSgpIDogMDtcbiAgICAgICAgICAgICAgICAgICAgW2FsbG93ZWRFdmVudHMsIGNvdW50XSA9IGF3YWl0IHNlYXJjaC5xdWVyeShrZXlzLCBzZWFyY2hGaWx0ZXIsIFNlYXJjaE9yZGVyLlJlY2VudCwgc2VhcmNoVGVybSwgZnJvbSwgZXZlbnRDb250ZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBnZXQgbmV4dCBiYWNrIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICByZXMuc2VuZFN0YXR1cyg1MDEpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhbGxvd2VkRXZlbnRzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICByZXMuanNvbih7XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByb29tX2V2ZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGhpZ2hsaWdodHNTdXBlcnNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8UmVzdWx0PiA9IFtdO1xuXG4gICAgICAgICAgICBhbGxvd2VkRXZlbnRzLmZvckVhY2goKHJvdzogRXZlbnRMb29rdXBSZXN1bHQpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYWxjdWxhdGUgaGlnaHRsaWdodHNTdXBlcnNldFxuICAgICAgICAgICAgICAgIHJvdy5oaWdobGlnaHRzLmZvckVhY2goKGhpZ2hsaWdodDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGhpZ2hsaWdodHNTdXBlcnNldC5hZGQoaGlnaGxpZ2h0KTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHtldmVudDogZXZ9ID0gcm93O1xuXG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlSb29tSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHYgPSByb29tR3JvdXBzLmdldChldi5nZXRSb29tSWQoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICByb29tR3JvdXBzLnNldChldi5nZXRSb29tSWQoKSwgdik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2ID0gc2VuZGVyR3JvdXBzLmdldChldi5nZXRTZW5kZXIoKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdikgdiA9IG5ldyBHcm91cFZhbHVlKHJvdy5zY29yZSk7XG4gICAgICAgICAgICAgICAgICAgIHYuYWRkKGV2LmdldElkKCkpO1xuICAgICAgICAgICAgICAgICAgICBzZW5kZXJHcm91cHMuc2V0KGV2LmdldFNlbmRlcigpLCB2KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByb29tcy5hZGQoZXYuZ2V0Um9vbUlkKCkpO1xuXG4gICAgICAgICAgICAgICAgLy8gYWRkIHRvIHJlc3VsdHMgYXJyYXlcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPCBzZWFyY2hGaWx0ZXIubGltaXQpXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICByYW5rOiByb3cuc2NvcmUsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJvdy5ldmVudC5ldmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQ6IHJvdy5jb250ZXh0LFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJvb21TdGF0ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTxNYXRyaXhFdmVudD4+KCk7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETyBmZXRjaCBzdGF0ZSBmcm9tIHNlcnZlciB1c2luZyBBUEkgYmVjYXVzZSBqcy1zZGsgaXMgYnJva2VuIGR1ZSB0byBzdG9yZVxuICAgICAgICAgICAgICAgIHJvb21zLmZvckVhY2goKHJvb21JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvb20gPSBjbGkuZ2V0Um9vbShyb29tSWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocm9vbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9vbVN0YXRlTWFwLnNldChyb29tSWQsIHJvb20uY3VycmVudFN0YXRlLnJlZHVjZSgoYWNjLCBtYXA6IE1hcDxzdHJpbmcsIE1hdHJpeEV2ZW50PikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcC5mb3JFYWNoKChldjogTWF0cml4RXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjLnB1c2goZXYpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBbXSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3A6IE1hdHJpeFNlYXJjaFJlc3BvbnNlID0ge1xuICAgICAgICAgICAgICAgIHNlYXJjaF9jYXRlZ29yaWVzOiB7fSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvLyBzcGxpdCB0byBtYWtlIFR5cGVTY3JpcHQgaGFwcHkgd2l0aCB0aGUgaWYgc3RhdGVtZW50cyBmb2xsb3dpbmdcbiAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMgPSB7XG4gICAgICAgICAgICAgICAgaGlnaGxpZ2h0czogaGlnaGxpZ2h0c1N1cGVyc2V0LFxuICAgICAgICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgICAgICAgY291bnQsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBvbWl0ZW1wdHkgYmVoYXZpb3VyIHVzaW5nIGlmIHRvIGF0dGFjaCBvbnRvIG9iamVjdCB0byBiZSBzZXJpYWxpemVkXG4gICAgICAgICAgICBpZiAoZ2xvYmFsTmV4dEJhdGNoKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLm5leHRfYmF0Y2ggPSBnbG9iYWxOZXh0QmF0Y2g7XG4gICAgICAgICAgICBpZiAoaW5jbHVkZVN0YXRlKSByZXNwLnNlYXJjaF9jYXRlZ29yaWVzLnJvb21fZXZlbnRzLnN0YXRlID0gcm9vbVN0YXRlTWFwO1xuXG4gICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCB8fCBncm91cEJ5U2VuZGVyKSB7XG4gICAgICAgICAgICAgICAgcmVzcC5zZWFyY2hfY2F0ZWdvcmllcy5yb29tX2V2ZW50cy5ncm91cHMgPSBuZXcgTWFwPHN0cmluZywgTWFwPHN0cmluZywgR3JvdXBWYWx1ZT4+KCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXBCeVJvb21JZCkge1xuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIocm9vbUdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkucm9vbUlkLCByb29tR3JvdXBzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGdyb3VwQnlTZW5kZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplR3JvdXBWYWx1ZU9yZGVyKHNlbmRlckdyb3Vwcy52YWx1ZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3Auc2VhcmNoX2NhdGVnb3JpZXMucm9vbV9ldmVudHMuZ3JvdXBzLnNldChSZXF1ZXN0R3JvdXBLZXkuc2VuZGVyLCBzZW5kZXJHcm91cHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAgICAgICByZXMuanNvbihyZXNwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcignY2F0YXN0cm9waGUnLCB7ZXJyb3J9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcy5zZW5kU3RhdHVzKDUwMCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBwb3J0ID0gYXJncy5vcHRpb25zWydwb3J0J10gfHwgODAwMDtcbiAgICBhcHAubGlzdGVuKHBvcnQsICgpID0+IHtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ3dlIGFyZSBsaXZlJywge3BvcnR9KTtcbiAgICB9KTsqL1xufVxuXG4vLyBUT0RPIGdyb3Vwcy1wYWdpbmF0aW9uXG4vLyBUT0RPIGJhY2tmaWxsXG5cbmZ1bmN0aW9uIGZpbHRlck5hbWUoY2xpOiBNYXRyaXhDbGllbnQpOiBzdHJpbmcge1xuICAgIHJldHVybiBgTUFUUklYX1NFQVJDSF9GSUxURVJfJHtjbGkuY3JlZGVudGlhbHMudXNlcklkfWA7XG59XG5cbi8qXG5mdW5jdGlvbiBub3JtYWxpemVHcm91cFZhbHVlT3JkZXIoaXQ6IEl0ZXJhYmxlSXRlcmF0b3I8R3JvdXBWYWx1ZT4pIHtcbiAgICBsZXQgaSA9IDE7XG4gICAgQXJyYXkuZnJvbShpdCkuc29ydCgoYTogR3JvdXBWYWx1ZSwgYjogR3JvdXBWYWx1ZSkgPT4gYS5vcmRlci1iLm9yZGVyKS5mb3JFYWNoKChnOiBHcm91cFZhbHVlKSA9PiB7XG4gICAgICAgIC8vIG5vcm1hbGl6ZSBvcmRlciBiYXNlZCBvbiBzb3J0IGJ5IGZsb2F0XG4gICAgICAgIGcub3JkZXIgPSBpKys7XG4gICAgfSk7XG59XG4qL1xuXG4vKmNsYXNzIFNlYXJjaEZpbHRlciB7XG4gICAgcm9vbXM6IFNldDxzdHJpbmc+O1xuICAgIG5vdFJvb21zOiBTZXQ8c3RyaW5nPjtcbiAgICBzZW5kZXJzOiBTZXQ8c3RyaW5nPjtcbiAgICBub3RTZW5kZXJzOiBTZXQ8c3RyaW5nPjtcbiAgICB0eXBlczogU2V0PHN0cmluZz47XG4gICAgbm90VHlwZXM6IFNldDxzdHJpbmc+O1xuICAgIGxpbWl0OiBudW1iZXI7XG4gICAgY29udGFpbnNVUkw6IGJvb2xlYW4gfCB1bmRlZmluZWQ7XG5cbiAgICBjb25zdHJ1Y3RvcihvOiBvYmplY3QpIHtcbiAgICAgICAgdGhpcy5yb29tcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydyb29tcyddKTtcbiAgICAgICAgdGhpcy5ub3RSb29tcyA9IG5ldyBTZXQ8c3RyaW5nPihvWydub3Rfcm9vbXMnXSk7XG4gICAgICAgIHRoaXMuc2VuZGVycyA9IG5ldyBTZXQ8c3RyaW5nPihvWydzZW5kZXJzJ10pO1xuICAgICAgICB0aGlzLm5vdFNlbmRlcnMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3NlbmRlcnMnXSk7XG4gICAgICAgIHRoaXMudHlwZXMgPSBuZXcgU2V0PHN0cmluZz4ob1sndHlwZXMnXSk7XG4gICAgICAgIHRoaXMubm90VHlwZXMgPSBuZXcgU2V0PHN0cmluZz4ob1snbm90X3R5cGVzJ10pO1xuXG4gICAgICAgIHRoaXMubGltaXQgPSB0eXBlb2Ygb1snbGltaXQnXSA9PT0gXCJudW1iZXJcIiA/IG9bJ2xpbWl0J10gOiAxMDtcbiAgICAgICAgdGhpcy5jb250YWluc1VSTCA9IG9bJ2NvbnRhaW5zX3VybCddO1xuICAgIH1cbn0qL1xuXG4vKmludGVyZmFjZSBSZXF1ZXN0RXZlbnRDb250ZXh0IHtcbiAgICBiZWZvcmVfbGltaXQ/OiBudW1iZXI7XG4gICAgYWZ0ZXJfbGltaXQ/OiBudW1iZXI7XG4gICAgaW5jbHVkZV9wcm9maWxlOiBib29sZWFuO1xufSovXG5cbi8qZW51bSBSZXF1ZXN0R3JvdXBLZXkge1xuICAgIHJvb21JZCA9IFwicm9vbV9pZFwiLFxuICAgIHNlbmRlciA9IFwic2VuZGVyXCIsXG59XG5cbmludGVyZmFjZSBSZXF1ZXN0R3JvdXAge1xuICAgIGtleTogUmVxdWVzdEdyb3VwS2V5O1xufVxuXG5pbnRlcmZhY2UgUmVxdWVzdEdyb3VwcyB7XG4gICAgZ3JvdXBfYnk/OiBBcnJheTxSZXF1ZXN0R3JvdXA+O1xufSovXG5cbmVudW0gUmVxdWVzdEtleSB7XG4gICAgYm9keSA9IFwiY29udGVudC5ib2R5XCIsXG4gICAgbmFtZSA9IFwiY29udGVudC5uYW1lXCIsXG4gICAgdG9waWMgPSBcImNvbnRlbnQudG9waWNcIixcbn1cblxuY29uc3QgaW5kZXhhYmxlS2V5cyA9IFtSZXF1ZXN0S2V5LmJvZHksIFJlcXVlc3RLZXkubmFtZSwgUmVxdWVzdEtleS50b3BpY107XG5cbi8qaW50ZXJmYWNlIE1hdHJpeFNlYXJjaFJlcXVlc3RCb2R5IHtcbiAgICBzZWFyY2hfdGVybTogc3RyaW5nO1xuICAgIGtleXM/OiBBcnJheTxSZXF1ZXN0S2V5PjtcbiAgICBmaWx0ZXI/OiBvYmplY3Q7IC8vIHRoaXMgZ2V0cyBpbmZsYXRlZCB0byBhbiBpbnN0YW5jZSBvZiBGaWx0ZXJcbiAgICBvcmRlcl9ieT86IHN0cmluZztcbiAgICBldmVudF9jb250ZXh0PzogUmVxdWVzdEV2ZW50Q29udGV4dDtcbiAgICBpbmNsdWRlU3RhdGU/OiBib29sZWFuO1xuICAgIGdyb3VwaW5ncz86IFJlcXVlc3RHcm91cHM7XG59XG5cbmludGVyZmFjZSBNYXRyaXhTZWFyY2hSZXF1ZXN0IHtcbiAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICByb29tX2V2ZW50cz86IE1hdHJpeFNlYXJjaFJlcXVlc3RCb2R5O1xuICAgIH1cbn1cblxuaW50ZXJmYWNlIE1hdHJpeFNlYXJjaFJlc3BvbnNlIHtcbiAgICBzZWFyY2hfY2F0ZWdvcmllczoge1xuICAgICAgICByb29tX2V2ZW50cz86IHtcbiAgICAgICAgICAgIGNvdW50OiBudW1iZXI7XG4gICAgICAgICAgICByZXN1bHRzOiBBcnJheTxSZXN1bHQ+O1xuICAgICAgICAgICAgaGlnaGxpZ2h0czogU2V0PHN0cmluZz47XG4gICAgICAgICAgICBzdGF0ZT86IE1hcDxzdHJpbmcsIEFycmF5PEV2ZW50Pj47XG4gICAgICAgICAgICBncm91cHM/OiBNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBHcm91cFZhbHVlPj47XG4gICAgICAgICAgICBuZXh0X2JhdGNoPzogc3RyaW5nO1xuICAgICAgICB9XG4gICAgfVxufSovIl19