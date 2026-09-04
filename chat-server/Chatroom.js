const Message = require('./Message');
const Redis = require('ioredis');

class Chatroom {
    static userStatus = {
        JOINED      : 'JOINED',
        LEFT        : 'LEFT',
        DISCONNECTED: 'DISCONNECTED'
    };

    /**
     * @param {string} id
     * @param {string} name
     * @param {string} token
     * @param {string} serverType
     * @param {Logger} logger
     * @param {Redis} redis
     */
    constructor(id, name, token, serverType, logger, redis) {
        this.id = id;
        this.name = name;
        this.token = token;
        this.users = new Map();
        this.maxHistorySize = 100;
        this.serverType = serverType;
        this.logger = logger;
        this.redis = redis;
        this.redisHistoryKey = this.serverType + '/' + this.token + '/HISTORY';
    }

    /**
     * @param {User} user
     * @param {boolean} hasWriteAccess
     */
    addUser(user, hasWriteAccess = true) {
        user.chatroomAccess = user.chatroomAccess || {};
        const userStatus = user.chatroomAccess[this.token]?.status || Chatroom.userStatus.LEFT;
        user.chatroomAccess[this.token] = {
            chatRoom          : this.id,
            name              : this.name,
            token             : this.token,
            hasWriteAccess    : hasWriteAccess,
            unseenMessageCount: 0,
            status            : userStatus
        };
        if (this.users.has(user.id)) {
            this.users.set(user.id, user);
            this.logger.log(`User ${user.name}#${user.id} User data has been updated in the chatroom Name: ${this.name} Token: ${this.token} UserCount: ${this.users.size}`);
        } else {
            this.users.set(user.id, user);
            this.logger.log(`User ${user.name}#${user.id} added to chatroom Name: ${this.name} Token: ${this.token} UserCount: ${this.users.size}`);
        }
    }

    /**
     * @param {string} userId
     * @returns {boolean}
     */
    hasUser(userId) {
        return this.users.has(userId);
    }

    /**
     * @param {string} userId
     * @returns {boolean}
     */
    canUserWrite(userId) {
        const user = this.users.get(userId);
        return user.chatroomAccess[this.token].hasWriteAccess;
    }

    /**
     * @param {Message} message
     */
    addMessage(message) {
        this.redis.exists(this.redisHistoryKey).then(exists => {
            if (exists !== 1) {
                this.redis.call('JSON.SET', this.redisHistoryKey, '$', JSON.stringify({ messages: [] })).then(setResult => {
                    this.logger.log(`JSON.SET ${this.redisHistoryKey} setResult:`, setResult);
                });
            }
            this.redis.call('JSON.ARRAPPEND', this.redisHistoryKey, '.messages', JSON.stringify(message.serialize())).then(appendResult => {
                this.logger.log(`JSON.ARRAPPEND ${this.redisHistoryKey} appendResult:`, appendResult);
                this.logger.log(`Message added to the history of the chatroom Name: ${this.name} Token: ${this.token} UserCount: ${this.users.size}`);
                if (appendResult > this.maxHistorySize) {
                    this.redis.call('JSON.ARRPOP', this.redisHistoryKey, '.messages', 0).then(poppResult => {
                        this.logger.log(`JSON.ARRPOP ${this.redisHistoryKey} poppResult:`, poppResult);
                    });
                }
            });
        });
    }

    /**
     * @param {Message} message
     * @param {string|null} excludeUserId
     */
    broadcast(message, excludeUserId = null) {
        const serializedMsg = message.serialize();
        const receivers = {};
        this.users.forEach((user, userId) => {
            this.logger.warn(`User is connected: ${user.name}#${user.id} -> ${user.isConnected() ? 'true' : 'false'} / ${user.chatroomAccess[this.token].status}`);
            receivers[user.id] = {received: false};
            if (userId !== excludeUserId) {
                if (user.isConnected() && user.chatroomAccess[this.token].status === Chatroom.userStatus.JOINED) {
                    user.send(serializedMsg);
                    receivers[user.id].received = true;
                }
            }
        });
        if (message.messageType === Message.messageType.TEXT) {
            message.setReceivers(receivers);
            this.addMessage(message);
        }
    }

    /**
     * @param {string} userId
     * @returns {Array}
     */
    async getHistory(userId) {
        const messages = [];
        await this.redis.exists(this.redisHistoryKey).then(async exists => {
            if (exists !== 1) {
                this.redis.call('JSON.SET', this.redisHistoryKey, '$', JSON.stringify({messages: []})).then(setResult => {
                    this.logger.log(`JSON.SET ${this.redisHistoryKey} setResult:`, setResult);
                });
            }
            await this.redis.call('JSON.GET', this.redisHistoryKey).then(messageHistory => {
                messageHistory = JSON.parse(messageHistory);
                messageHistory.messages.forEach((messageData) => {
                    messageData = JSON.parse(messageData);
                    const message = new Message({
                        messageType: messageData.messageType,
                        message    : messageData.message,
                        sender     : messageData.sender,
                        chatRoom   : messageData.chatRoom,
                        token      : messageData.token,
                        timestamp  : messageData.timestamp
                    });
                    message.setReceivers(messageData.receivers);
                    message.addReceiver(userId);
                    messages.push(message);
                });
            });
        });
        return messages;
    }
}

module.exports = Chatroom;