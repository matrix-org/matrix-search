import {MatrixEvent} from 'matrix-js-sdk';

MatrixEvent.prototype.getClearEvent = function() {
    if (!this.isEncrypted()) return this.event;
    return Object.assign({}, this.event, this._clearEvent);
};