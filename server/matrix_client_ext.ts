import {Event, EventWithContext, MatrixClient, MatrixEvent} from 'matrix-js-sdk';

const utils = require('matrix-js-sdk/src/utils');

// "dumb" mapper because e2e should be decrypted in browser, so we don't lose verification status
function getMapper(cli: MatrixClient) {
    return function(plainOldJsObject: Event): MatrixEvent {
        return new MatrixEvent(plainOldJsObject);
    }
}

MatrixClient.prototype.fetchEvent = async function(roomId: string, eventId: string): Promise<MatrixEvent> {
    const path = utils.encodeUri('/rooms/$roomId/event/$eventId', {
        $roomId: roomId,
        $eventId: eventId,
    });

    let res;
    try {
        res = await this._http.authedRequest(undefined, 'GET', path);
    } catch (e) {}

    if (!res) throw new Error("'event' not in '/event' result - homeserver too old?");

    return getMapper(this)(res);
};

// XXX: use getEventTimeline once we store rooms properly
MatrixClient.prototype.fetchEventContext = async function(roomId: string, eventId: string, limit: number): Promise<EventWithContext> {
    const path = utils.encodeUri('/rooms/$roomId/context/$eventId', {
        $roomId: roomId,
        $eventId: eventId,
    });

    let res;
    try {
        res = await this._http.authedRequest(undefined, 'GET', path, {limit});
    } catch (e) {}

    if (!res || !res.event)
        throw new Error("'event' not in '/event' result - homeserver too old?");

    // const mapper = this.getEventMapper();

    const mapper = getMapper(this);

    const event = mapper(res.event);

    const state = res.state.map(mapper);
    const events_after = res.events_after.map(mapper);
    const events_before = res.events_before.map(mapper);

    return {
        event,
        context: {
            start: res.start,
            end: res.end,
            state,
            events_after,
            events_before,
        },
    };
};

MatrixEvent.prototype.getClearEvent = function() {
    if (!this.isEncrypted()) return this.event;
    return Object.assign({}, this.event, this._clearEvent);
};