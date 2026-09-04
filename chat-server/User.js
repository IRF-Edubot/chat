const {userStatus} = require('./Chatroom');

class User {
    /**
     * @param {string} id
     * @param {string} name
     */
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.connection = null;
        this.lastActivity = new Date().toISOString();
        this.chatroomAccess = {};
        this.activeRoomToken = null;
    }

    /**
     * @returns {Object}
     */
    getUserInfo() {
        return {
            id             : this.id,
            name           : this.name,
            lastActivity   : this.lastActivity,
            activeRoomToken: this.activeRoomToken
        };
    }

    send(data) {
        if (this.isConnected()) {
            this.connection.send(data);
        }
    }

    ping() {
        try {
            this.connection.ping();
        } catch (error) {
            console.error(`Error pinging user ${this.id}: ${error.message}`);
        }
    }

    updateActivity() {
        this.lastActivity = new Date().toISOString();
    }

    /**
     * @returns {boolean}
     */
    isConnected() {
        return this.connection && this.connection.readyState === 1;
    }

    /**
     * @param {string, null} token
     */
    setActiveRoom(token) {
        Object.entries(this.chatroomAccess).forEach(([key, chatroom]) => {
            if (key === token) {
                chatroom.status = userStatus.JOINED;
                this.activeRoomToken = token;
            } else {
                chatroom.status = userStatus.LEFT;
            }
        });
    }

    /**
     * @returns {Array}
     */
    getChatRooms() {
        const chatRooms = [];
        Object.entries(this.chatroomAccess).forEach(chatroom => {
            chatRooms.push({
                chatRoom          : chatroom.chatRoom,
                name              : chatroom.name,
                token             : chatroom.token,
                unseenMessageCount: chatroom.unseenMessageCount
            });
        });
        return chatRooms;
    }
}

module.exports = User;