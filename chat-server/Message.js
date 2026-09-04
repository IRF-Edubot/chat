class Message {
    static messageType = {
        ERROR         : 'ERROR',
        HISTORY       : 'HISTORY',
        JOIN          : 'JOIN',
        JOINED        : 'JOINED',
        LEAVE         : 'LEAVE',
        LEFT          : 'LEFT',
        PONG          : 'PONG',
        QUERYCHATROOMS: 'QUERYCHATROOMS',
        SYSTEM        : 'SYSTEM',
        TEXT          : 'TEXT',
        USERINFO      : 'USERINFO'
    };

    /**
     * @param {Object} options
     * @property {string} options.messageType
     */
    constructor(options) {
        this.timestamp = new Date().toISOString();
        this.messageType = options.messageType;
        Object.entries(options).forEach(([key, option]) => {
            this[key] = option;
        });
        this.receivers = [];
    }

    /**
     * @returns {string}
     */
    serialize() {
        return JSON.stringify(this);
    }

    /**
     * @param {Object} receivers
     */
    setReceivers(receivers) {
        this.receivers = receivers;
    }

    /**
     * @param {string} userId
     */
    addReceiver(userId) {
        this.receivers[userId] = {received: true};
    }
}

module.exports = Message;