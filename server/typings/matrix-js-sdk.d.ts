// Type definitions for matrix-js-sdk
// Project: matrix-js-sdk
// Definitions by: Will Hunt <will@half-shot.uk>


export declare class Matrix {

    //class IndexedDBStoreBackend {

}

export class SyncAccumulator {
    constructor(opts: SyncAccumulatorOpts);
    getJSON(): any;
}

export class MatrixHttpApi {

}

export class MatrixError {
    errcode: string;
    name: string;
    message: string;
    data: any;
    httpStatus: number;
    constructor(errorJson: any);
}

export class MatrixClient {
    constructor(opts: MatrixClientOpts);

    _http: any;

    private _requestTokenFromEndpoint(endpoint: string, params: object): Promise<string>

    fetchEvent(roomId: string, eventId: string);
    fetchEventContext(roomId: string, eventId: string)

    acceptGroupInvite(groupId: string, opts: object): Promise<object> | MatrixError;
    addListener(event: string, listener: any);
    addPushRule(scope: string, kind: string, ruleId: string, body: object, callback?: requestCallback): Promise<any> | MatrixError | void;
    addRoomToGroup(groupId: string, roomId: string, isPublic: boolean): Promise<object> | MatrixError;
    addRoomToGroupSummary(groupId: string, roomId: string, categoryId?: string): Promise<object> | MatrixError;
    addThreePid(creds: object, bind: boolean, callback?: requestCallback): Promise<any> | MatrixError | void;
    addUserToGroupSummary(groupId: string, userId: string, roleId?: string): Promise<object> | MatrixError;
    backPaginateRoomEventsSearch(searchResults: object): Promise<object> | MatrixError;
    ban(roomId: string, userId: string, reason?: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    cancelAndResendEventRoomKeyRequest(event: MatrixEvent);
    cancelPendingEvent(event: MatrixEvent); // throws error if the event is not in QUEUED or NOT_SENT state.
    cancelUpload(promise: Promise<any>): boolean;
    claimOneTimeKeys(devices: Array<string>, keyAlgorithm?: string): Promise<object> | MatrixError;
    clearStores(): Promise<void>;
    createAlias(alias: string, roomId: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    createFilter(content: object): Promise<object> | MatrixError;
    createGroup(content: {localpart: string, profile: object}): Promise<{group_id: string}> | MatrixError;
    createRoom(options: {room_alias_name?: string, visibility?: string, invite?: Array<string>, name?: string, topic?: string}, callback?: requestCallback): Promise<{room_id: string, room_alias?: string}> | MatrixError | void;
    deactivateAccount(auth?: object, callback?: requestCallback): Promise<object>;
    deleteAlias(alias: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    deleteDevice(deviceId: string, auth?: object): Promise<object> | MatrixError;
    deleteMultipleDevices(devices: Array<string>, auth?: object): Promise<object> | MatrixError;
    deletePushRule(scope: string, kind: string, ruleId: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    deleteRoomTag(roomId: string, tagName: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    deleteThreePid(medium: string, address: string): Promise<object> | MatrixError;
    downloadKeys(userIds: Array<string>, forceDownload: boolean): Promise<object> | MatrixError;
    downloadKeysForUsers(userIds: Array<string>, opts?: object): Promise<object> | MatrixError;
    dropFromPresenceList(callback?: requestCallback, userIds?: Array<string>): Promise<any> | MatrixError | void; // TODO
    emit(event: string, listener: any): boolean;
    exportRoomKeys(): Promise<any>;
    forget(roomId: string, deleteRoom: boolean, callback?: requestCallback): Promise<any> | MatrixError | void;
    generateClientSecret(): string;
    getAccessToken(): string | null;
    getAccountData(eventType: string): object | null;
    getCanResetTimelineCallback(): any | null;
    getCasLoginUrl(redirectUrl: string): string;
    getCurrentUploads(): Array<{promise: Promise<any>, loaded: number, total: number}>;
    getDeviceEd25519Key(): string | null;
    getDeviceId(): string | null;
    getDevices(): Promise<object> | MatrixError;
    getDomain(): string | null;
    getEventMapper(): any;
    getEventSenderDeviceInfo(event: MatrixEvent): Promise<object> | MatrixError;
    getEventTimeline(timelineSet: any, eventId: string): Promise<EventTimelineSet>;
    getFallbackAuthUrl(loginType: string, authSessionId: string): string;
    getFilter(userId: string, filterId: string, allowCached?: boolean): Promise<any> | MatrixError;
    getGlobalBlacklistUnverifiedDevices(): boolean;
    getGroup(groupId: string): Group | null;
    getGroupInvitedUsers(groupId: string): Promise<object> | MatrixError;
    getGroupProfile(groupId: string): Promise<object> | MatrixError;
    getGroupRooms(groupId: string): Promise<object> | MatrixError;
    getGroups(): Array<Group>;
    getGroupSummary(groupId: string): Promise<object> | MatrixError;
    getGroupUsers(groupId: string): Promise<object> | MatrixError;
    getHomeserverUrl(): string;
    getIdentityServerUrl(stripProto?: boolean): string;
    getIgnoredUsers(): Array<string>;
    getJoinedGroups(): Promise<any> | MatrixError;
    getKeyChanges(oldToken: string, newToken: string): Promise<object> | MatrixError;
    getNotifTimelineSet(): EventTimelineSet | null;
    getOpenIdToken(): Promise<object> | MatrixError;
    getOrCreateFilter(filterName: string, filter: Filter): Promise<string> | MatrixError;
    getPresenceList(callback?: requestCallback): Promise<any> | MatrixError | void;
    getProfileInfo(userId: string, info: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    getPublicisedGroups(userIds: Array<string>): Promise<object> | MatrixError;
    getPushActionsForEvent(event: MatrixEvent): object;
    getPushers(callback?: requestCallback): Promise<Array<object>> | MatrixError | void;
    getPushRules(callback?: requestCallback): Promise<any> | MatrixError | void;
    getRoom(roomId: string): Room | null;
    getRoomDirectoryVisibility(roomId: string, callback?: requestCallback): Promise<any> | MatrixError | void;
    getRoomIdForAlias(alias: string, callback?: requestCallback): Promise<object> | MatrixError | void;
    getRoomPushRule(scope: string, roomId: string): object | undefined;
    getRooms(): Array<Room>
}
/*
export class MatrixScheduler implements IMatrixScheduler {
    getQueueForEvent(Event: Models.MatrixEvent): Models.MatrixEvent[]|null;
    queueEvent(Event: Models.MatrixEvent): Promise<void>;
    removeEventFromQueue(Event: Models.MatrixEvent): boolean;
    setProcessFunction(fn: MatrixSchedulerProcessFunction): void;
}
*/
export class ContentRepo {

}

export class Filter {

}

export class TimelineWindow {

}

export class InteractiveAuth {

}

export type RoomSummaryInfo = {
    title: string;
    desc: string;
    numMembers: number;
    aliases: string[];
    timestamp: number;
}

export type MatrixClientOpts = {
    baseUrl?: string;
    idBaseUrl?: string;
    request?: requestFunction;
    accessToken?: string;
    userId?:	string;
    store?: IMatrixStore;
    deviceId?: string
    sessionStore?: ICryptoStore;
    scheduler?: IMatrixScheduler;
    queryParams?: any;
    localTimeoutMs?: number;
    useAuthorizationHeader?: boolean;
    timelineSupport?: boolean;
    cryptoStore?: ICryptoStore;
}

export type CreateClientOps = {
    store: IMatrixStore,
    scheduler: IMatrixScheduler,
    request: ()=>void,
    cryptoStore: ICryptoStore
}

export type RequestOpts = {

}

export type requestCallback = (err: Error, response: any, body: any)=>void;
export type requestFunction = (opts: RequestOpts, callback: requestCallback)=>void;
//export type MatrixSchedulerProcessFunction = (Event: Models.MatrixEvent)=> Promise<void>;

export type SyncAccumulatorOpts = {
    maxTimelineEntries: number;
}

export interface ICryptoStore {

}

export interface IMatrixStore {
    deleteAllData(): Promise<void>;
    getAccountData(eventType: string): void;
    getFilter(userId: string, filterId: string): void;
    getFilterIdByName(filterName: string): void;
    //getGroup(): Models.Group;
    //getGroups(): Models.Group[];
    //getRoom(roomId: string): Models.Room;
    //getRooms(): Models.Room[];
    getRoomSummaries(): RoomSummary[];
    getSavedSync(): Promise<any>;
    getSyncToken(): string;
    //getUser(userId: string): Models.User;
    //getUsers(): Models.User[];
    removeRoom(roomId: string): void;
    save(): void;
    //scrollback(room: Models.Room, limit: number): any[];
    setFilterIdByName(filterName: string, filterId: string): void;
    setSyncData(syncData: any): Promise<void>;
    setSyncToken(token: string): void;
    startup(): Promise<void>;
    //storeAccountDataEvents(events: Models.MatrixEvent[]): void;
    //storeEvents(room: Models.Room, events: Models.MatrixEvent[], token: string, toStart: boolean): void;
    storeFilter(filter: Filter): void;
    //storeGroup(group: Models.Group): void;
    //storeRoom(room: Models.Room): void;
    //storeUser(user: Models.User): void;
}

// Classes


// models/room-summary.js
export class RoomSummary {
    roomId: string;
    info: RoomSummaryInfo;
    constructor(roomId: string, info: RoomSummaryInfo);
}


// Opts Types

// Interfaces

export interface IMatrixScheduler {
    //getQueueForEvent(Event: Models.MatrixEvent): Models.MatrixEvent[]|null;
    //queueEvent(Event: Models.MatrixEvent): Promise<void>;
    //removeEventFromQueue(Event: Models.MatrixEvent): boolean;
    //setProcessFunction(fn: MatrixSchedulerProcessFunction): void;
}

// Global Functions

// function createClient(opts: CreateClientOps|String): MatrixClient {

// Export Models and Stores that are global.
// }

/*

/!*
Event-context.js
room-summary.js
search-result.js
 *!/

declare namespace Matrix.Models {

    /!* models/Event-timeline.js*!/
    */
    export class EventTimeline {

    }
    /*

    /!* models/Event-timeline-set*!/
    */
    export class EventTimelineSet {

    }
    /*

    /!* models/Event.js *!/
    */
    export class Event {
        sender: string;
        room_id: string;
        content: object;
    }

    interface MapStringString {
        [key: string]: string
    }

    export class MatrixEvent {
        event: Event;
        // sender: RoomMember;
        // target: RoomMember;
        // status: EventStatus;
        error: Error;
        forwardLooking: boolean;
        constructor(event: Event);

        readonly EventStatus: string;
        private _setClearData(decryptionResult: any);
        attemptDecryption(crypto: any): Promise<void>;
        getAge(): number;
        getClaimedEd25519Key(): string;
        getContent(): object;
        getDate(): Date;
        getDirectionalContent(): object;
        getForwardingCurve25519KeyChain(): Array<string>;
        getId(): string;
        getKeysClaimed(): MapStringString;
        getPrevContent(): object;
        getPushActions(): object | null;
        getRoomId(): string;
        getSender(): string;
        getSenderKey(): string;
        getStateKey(): string | undefined;
        getTs(): number;
        getType(): string;
        getWireContent(): object;
        getWireType(): string;
        handleRemoteEcho(event: Event);
        isBeingDecrypted(): boolean;
        isDecryptionFailure(): boolean;
        isEncrypted(): boolean;
        isRedacted(): boolean;
        isState(): boolean;
        makeEncrypted(cryptoType: string, cryptoContent: object, senderCurve25519Key: string, claimedEd25519Key: string)
        makeRedacted(redactionEvent: MatrixEvent)
        setPushActions(pushActions: object)
    }
    /*

    export class EventStatus {
        NOT_SENT: string;
        ENCRYPTING: string;
        SENDING: string;
        QUEUED: string;
        SENT: string;
        CANCELLED: string;
    }

    /!* models/group.js *!/
    */
    export class Group {
        groupId: string;
        name: string;
        avatarUrl: string;
        myMembership: string;
        inviter: any;
        constructor(groupId: string);
        setProfile(name: string, avatarUrl: string): void;
        setMyMembership(membership: string): void;
        setInviter(inviter: string): void;
    }
    /*

    /!* models/room.js *!/
    */
    export class Room {
        roomId: string;
    }
    /*

    /!* models/room-member.js*!/
    export class RoomMember {

    }

    /!* models/room-state.js *!/
    export class RoomState {

    }

    /!* models/user.js*!/
    export class User {

    }
}

declare namespace Matrix.Crypto {

    export interface CryptoStore {

    }

    export class MemoryCryptoStore implements CryptoStore {

    }

    export class IndexedDBCryptoStore implements CryptoStore {

    }
}
declare namespace Matrix.Store {

    export class MatrixInMemoryStore implements IMatrixStore {
        //Incomplete
        deleteAllData(): Promise<void>;
        getAccountData(eventType: string): void;
        getFilter(userId: string, filterId: string): void;
        getFilterIdByName(filterName: string): void;
        getGroup(): Models.Group;
        getGroups(): Models.Group[];
        getRoom(roomId: string): Models.Room;
        getRooms(): Models.Room[];
        getRoomSummaries(): RoomSummary[];
        getSavedSync(): Promise<any>;
        getSyncToken(): string;
        getUser(userId: string): Models.User;
        getUsers(): Models.User[];
        removeRoom(roomId: string): void;
        save(): void;
        scrollback(room: Models.Room, limit: number): any[];
        setFilterIdByName(filterName: string, filterId: string): void;
        setSyncData(syncData: any): Promise<void>;
        setSyncToken(token: string): void;
        startup(): Promise<void>;
        storeAccountDataEvents(events: Models.MatrixEvent[]): void;
        storeEvents(room: Models.Room, events: Models.MatrixEvent[], token: string, toStart: boolean): void;
        storeFilter(filter: Filter): void;
        storeGroup(group: Models.Group): void;
        storeRoom(room: Models.Room): void;
        storeUser(user: Models.User): void;
    }

    export class IndexedDBStore implements IMatrixStore {
        //Incomplete
        deleteAllData(): Promise<void>;
        getAccountData(eventType: string): void;
        getFilter(userId: string, filterId: string): void;
        getFilterIdByName(filterName: string): void;
        getGroup(): Models.Group;
        getGroups(): Models.Group[];
        getRoom(roomId: string): Models.Room;
        getRooms(): Models.Room[];
        getRoomSummaries(): RoomSummary[];
        getSavedSync(): Promise<any>;
        getSyncToken(): string;
        getUser(userId: string): Models.User;
        getUsers(): Models.User[];
        removeRoom(roomId: string): void;
        save(): void;
        scrollback(room: Models.Room, limit: number): any[];
        setFilterIdByName(filterName: string, filterId: string): void;
        setSyncData(syncData: any): Promise<void>;
        setSyncToken(token: string): void;
        startup(): Promise<void>;
        storeAccountDataEvents(events: Models.MatrixEvent[]): void;
        storeEvents(room: Models.Room, events: Models.MatrixEvent[], token: string, toStart: boolean): void;
        storeFilter(filter: Filter): void;
        storeGroup(group: Models.Group): void;
        storeRoom(room: Models.Room): void;
        storeUser(user: Models.User): void;
    }

    export class WebStorageSessionStore implements IMatrixStore {
        //Incomplete
        deleteAllData(): Promise<void>;
        getAccountData(eventType: string): void;
        getFilter(userId: string, filterId: string): void;
        getFilterIdByName(filterName: string): void;
        getGroup(): Models.Group;
        getGroups(): Models.Group[];
        getRoom(roomId: string): Models.Room;
        getRooms(): Models.Room[];
        getRoomSummaries(): RoomSummary[];
        getSavedSync(): Promise<any>;
        getSyncToken(): string;
        getUser(userId: string): Models.User;
        getUsers(): Models.User[];
        removeRoom(roomId: string): void;
        save(): void;
        scrollback(room: Models.Room, limit: number): any[];
        setFilterIdByName(filterName: string, filterId: string): void;
        setSyncData(syncData: any): Promise<void>;
        setSyncToken(token: string): void;
        startup(): Promise<void>;
        storeAccountDataEvents(events: Models.MatrixEvent[]): void;
        storeEvents(room: Models.Room, events: Models.MatrixEvent[], token: string, toStart: boolean): void;
        storeFilter(filter: Filter): void;
        storeGroup(group: Models.Group): void;
        storeRoom(room: Models.Room): void;
        storeUser(user: Models.User): void;
    }

    export class StubStore implements IMatrixStore {
        deleteAllData(): Promise<void>;
        getAccountData(eventType: string): void;
        getFilter(userId: string, filterId: string): void;
        getFilterIdByName(filterName: string): void;
        getGroup(): Models.Group;
        getGroups(): Models.Group[];
        getRoom(roomId: string): Models.Room;
        getRooms(): Models.Room[];
        getRoomSummaries(): RoomSummary[];
        getSavedSync(): Promise<any>;
        getSyncToken(): string;
        getUser(userId: string): Models.User;
        getUsers(): Models.User[];
        removeRoom(roomId: string): void;
        save(): void;
        scrollback(room: Models.Room, limit: number): any[];
        setFilterIdByName(filterName: string, filterId: string): void;
        setSyncData(syncData: any): Promise<void>;
        setSyncToken(token: string): void;
        startup(): Promise<void>;
        storeAccountDataEvents(events: Models.MatrixEvent[]): void;
        storeEvents(room: Models.Room, events: Models.MatrixEvent[], token: string, toStart: boolean): void;
        storeFilter(filter: Filter): void;
        storeGroup(group: Models.Group): void;
        storeRoom(room: Models.Room): void;
        storeUser(user: Models.User): void;
    }

}

*/