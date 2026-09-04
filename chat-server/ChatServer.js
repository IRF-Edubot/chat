const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const User = require('./User');
const Message = require('./Message');
const Chatroom = require('./Chatroom');
const AuthenticationManager = require('./AuthenticationManager');
const Logger = require('./Logger');
const Redis = require('ioredis');

class ChatServer {
    constructor() {
        this.options = {
            host        : '0.0.0.0',
            port        : 9898,
            pingInterval: 30000,
            serverType  : 'DUCK'
        };
        this.users = new Map();
        this.chatrooms = new Map();
        this.logger = new Logger();
        this.app = express();
        this.app.use(express.json());
        this.server = http.createServer(this.app);
        this.server.listen(this.options.port, this.options.host, () => {
            this.logger.log(`Server is running on port -> ${this.options.host}:${this.options.port}`);
        });
        this.wss = new WebSocket.Server({
            server      : this.server,
            verifyClient: this.verifyClient.bind(this)
        });
        this.redis = new Redis({
            host    : '127.0.0.1',
            port    : 6379,
            password: 'D9W?D2r0a0g8on'
        });
    }

    /**
     * @param {Object} info
     * @param {function} callback
     * @property {string} authResult.userData.userName
     * @property {string} authResult.userData.userID
     */
    async verifyClient(info, callback) {
        let verifyResult = {
            success     : false,
            errorCode   : 401,
            errorMessage: 'Error occurred',
            userData    : false
        };
        try {
            this.logger.log(`info.req:`, info.req);
            this.logger.log(`info.req.headers:`, info.req.headers);
            this.logger.log(`info.req.url: ${info.req.url}`);
            this.logger.log(`x-forwarded-host: ${info.req.headers['x-forwarded-host']}`);
            const currentURL = new URL('https://' + info.req.headers['x-forwarded-host'] + info.req.url);
            this.options.serverType = currentURL.hostname.split('.')[0] === 'test' ? 'TEST' : 'PRODUCTION';
            const cookies = this.parseCookies(info.req);
            this.logger.log(`cookies: ${JSON.stringify(cookies)}`);
            this.authManager = new AuthenticationManager('https://' + info.req.headers['x-forwarded-host'] + '/Wheatley/Core.php', this.logger);
            if (cookies.WSSESSIONID) {
                verifyResult = await this.verifyToken(cookies.WSSESSIONID);
                info.req.userData = verifyResult.userData;
            } else {
                this.logger.warn('Connection attempt without session token');
                verifyResult.errorCode = 401;
                verifyResult.errorMessage = 'Unauthorized: No session token provided';
            }
        } catch (error) {
            this.logger.error(`Authentication error: ${error.message}`);
            verifyResult.errorCode = 500;
            verifyResult.errorMessage = 'Internal server error during authentication';
        }
        return callback(verifyResult.success, verifyResult.errorCode, verifyResult.errorMessage);
    }

    /**
     * @param {string} token
     * @returns {Object}
     */
    async verifyToken(token) {
        const verifyResult = {
            success     : false,
            errorCode   : 401,
            errorMessage: 'Error occurred',
            userData    : false
        };
        const authResult = await this.authManager.authenticate(token);
        if (authResult.success) {
            verifyResult.userData = authResult.userData;
            this.logger.log(`Authentication success: ${verifyResult.userData.userName}#${verifyResult.userData.userID}`);
            verifyResult.success = true;
            verifyResult.errorCode = 200;
            verifyResult.errorMessage = `Authentication success: ${verifyResult.userData.userName}#${verifyResult.userData.userID}`;
            this.init();
        } else {
            this.logger.warn('Connection attempt without session token');
            verifyResult.errorCode = 401;
            verifyResult.errorMessage = 'Unauthorized: Invalid session token';
        }
        return verifyResult;
    }

    /**
     * @param {Object} request
     * @returns {Object}
     */
    parseCookies(request) {
        const list = {
            WSSESSIONID: ''
        };
        const cookieHeader = request.headers?.cookie;
        if (cookieHeader) {
            cookieHeader.split(`;`).forEach(cookie => {
                let [name, ...rest] = cookie.split(`=`);
                name = name?.trim();
                if (!name) {
                    return;
                }
                const value = rest.join(`=`).trim();
                if (!value) {
                    return;
                }
                list[name] = decodeURIComponent(value);
            });
        }

        return list;
    }

    init() {
        this.wss.on('connection', this.handleConnection.bind(this));
        setInterval(() => {
            this.pingAllClients();
        }, this.options.pingInterval);
        this.logger.log('WebSocket server initialized');
        this.reloadChatRooms();
        this.app.post('/sendMessage', (req, res) => {
            const {
                      chatRoomToken,
                      senderName,
                      message
                  } = req.body;
            this.logger.log('Received POST data:');
            this.logger.log(`Token: ${chatRoomToken}`);
            this.logger.log(`Sender: ${senderName}`);
            this.logger.log(`Message: ${message}`);
            const chatroom = this.chatrooms.get(chatRoomToken);
            this.logger.log(`Received a message from PHP backend in the chatroom Name: ${chatroom.name} Token: ${chatroom.token} UserCount: ${chatroom.users.size}`);
            if (chatroom) {
                const systemMessage = new Message({
                    messageType: Message.messageType.TEXT,
                    message    : message,
                    sender     : senderName,
                    chatRoom   : chatroom.id,
                    token      : chatroom.token,
                    timestamp  : new Date().toISOString()
                });
                chatroom.broadcast(systemMessage);
            }
            res.json({
                status : 'success',
                message: 'Data processed successfully'
            });
        });
        this.app.post('/updateChatRooms', (req, res) => {
            this.reloadChatRooms();
            res.json({
                status : 'success',
                message: 'Update processed successfully'
            });
        });
        this.logger.log('Routing initialized');
    }

    reloadChatRooms() {
        this.redis.get(this.options.serverType + '/ALLCHATROOMS').then(chatRooms => {
            chatRooms = JSON.parse(chatRooms);
            chatRooms.forEach(chatroomData => {
                const chatroom = this.createChatroom(chatroomData);
                chatroomData.users.forEach(userData => {
                    let user = this.users.get(userData.userID);
                    if (!user) {
                        user = this.createUser(userData);
                    }
                    chatroom.addUser(user, userData.hasWriteAccess);
                });
            });
            this.logger.warn(`UserCount: ${this.users.size}`);
        });
    }

    /**
     * @param {WebSocket} ws
     * @param {Object} request
     */
    handleConnection(ws, request) {
        let user = this.users.get(request.userData.userID);
        if (!user) {
            user = this.createUser(request.userData);
        }
        this.logger.warn(`User is connected: ${user.isConnected() ? 'true' : 'false'} UserCount: ${this.users.size}`);
        if (!user.isConnected()) {
            user.connection = ws;
            this.logger.log(`Authenticated user connected: ${user.name}#${user.id}`);
            const welcomeMsg = new Message({
                messageType: Message.messageType.SYSTEM,
                message    : 'Welcome to the chat server!',
                sender     : 'system'
            });
            ws.on('message', (data) => this.handleMessage(data, user));
            ws.on('close', () => this.handleDisconnect(user));
            ws.on('error', (error) => this.handleError(error, user));
            user.send(welcomeMsg.serialize());
            user.updateActivity();
            this.logger.warn(`User is connected: ${user.isConnected() ? 'true' : 'false'}`);
        }
    }

    /**
     * @param {Object} userData
     * @property {string} userData.userID
     * @property {string} userData.userID
     * @property {string} userData.userName
     * @returns {User}
     */
    createUser(userData) {
        const user = new User(userData.userID, userData.userName);
        this.logger.log('User created: ', user.getUserInfo());
        this.users.set(userData.userID, user);
        return user;
    }

    /**
     * @param {String} data
     * @param {User} user
     */
    handleMessage(data, user) {
        try {
            const parsedData = JSON.parse(data);
            user.updateActivity();
            switch (parsedData.messageType) {
                case 'TEXT':
                    this.sendChatMessage(user, parsedData);
                    break;
                case 'JOIN':
                    if (parsedData.message !== user.activeRoomToken) {
                        this.chatroomJoin(user, parsedData.message);
                    }
                    break;
                case 'LEAVE':
                    if (parsedData.message === user.activeRoomToken) {
                        this.chatroomLeave(user, parsedData.message);
                    }
                    break;
                case 'PING' :
                    user.send(new Message({
                        messageType: Message.messageType.PONG
                    }).serialize());
                    break;
                case 'WHOAMI' :
                    user.send(new Message({
                        messageType: Message.messageType.USERINFO,
                        message    : user.getUserInfo()
                    }).serialize());
                    break;
                case 'QUERYCHATROOMS' :
                    const chatRooms = user.getChatRooms();
                    chatRooms.forEach(chatroomData => {
                        const chatroom = this.chatrooms.get(chatroomData.token);
                        if (chatroom) {
                            chatroom.messageHistory.forEach((message) => {
                                chatroomData.unseenMessageCount += message.receivers[user.id] ? 0 : 1;
                            });
                        }
                    });
                    user.send(new Message({
                        messageType: Message.messageType.QUERYCHATROOMS,
                        message    : chatRooms
                    }).serialize());
                    break;
                default:
                    this.logger.warn(`Unhandled message type: ${parsedData.messageType}`);
            }
        } catch (error) {
            this.logger.error(`Error handling message: ${error.message}`);
        }
    }

    /**
     * @param {User} user
     */
    handleDisconnect(user) {
        Object.entries(user.chatroomAccess).forEach(chatroom => {
            chatroom.status = Chatroom.userStatus.DISCONNECTED;
        });
        this.users.delete(user.id);
        this.logger.log(`User disconnected: ${user.name}#${user.id}`);
    }

    /**
     * @param {Object} error
     * @param {User} user
     */
    handleError(error, user) {
        this.logger.error(`WebSocket error for user ${user.name}#${user.id}: ${error.message}`);
    }

    /**
     * @param {Object} chatroomData
     * @property {string} chatroomData.eduBotChatRoomID
     * @returns {Chatroom}
     */
    createChatroom(chatroomData) {
        let chatroom = this.chatrooms.get(chatroomData.token);
        if (chatroom) {
            this.logger.log(`Use existing chatroom: Name: ${chatroom.name} Token: ${chatroom.token}`);
        } else {
            chatroom = new Chatroom(
                chatroomData.eduBotChatRoomID,
                chatroomData.name,
                chatroomData.token,
                this.options.serverType,
                this.logger,
                this.redis
            );
            this.chatrooms.set(chatroomData.token, chatroom);
            this.logger.log(`Created new chatroom: Name: ${chatroom.name} Token: ${chatroom.token}`);
        }
        return chatroom;
    }

    /**
     * @param {User} user - The sender
     * @param {Object} messageData - Message data
     */
    sendChatMessage(user, messageData) {
        if (user.activeRoomToken) {
            const chatroom = this.chatrooms.get(user.activeRoomToken);
            if (chatroom) {
                if (chatroom.hasUser(user.id)) {
                    if (chatroom.canUserWrite(user.id)) {
                        const message = new Message({
                            messageType: Message.messageType.TEXT,
                            message    : messageData.message,
                            sender     : user.name,
                            chatRoom   : chatroom.id,
                            token      : chatroom.token,
                            timestamp  : new Date().toISOString()
                        });
                        chatroom.broadcast(message);
                        this.logger.log(`Message in ID: ${chatroom.id} Name: ${chatroom.name} Token: ${chatroom.token} from ${user.name}#${user.id}: ${messageData.message}`);
                    } else {
                        this.logger.warn(`User ${user.name}#${user.id} tried to send message without write access in chatroom: ${user.activeRoomToken}`);
                        user.send(new Message({
                            messageType: Message.messageType.ERROR,
                            message    : 'You do not have permission to write in this chatroom',
                            token      : chatroom.token,
                            sender     : 'system'
                        }).serialize());
                    }
                } else {
                    this.logger.warn(`User ${user.name}#${user.id} tried to send message to chatroom they aren't in: ${user.activeRoomToken}`);
                    user.send(new Message({
                        messageType: Message.messageType.ERROR,
                        message    : 'You are not a member of this chatroom',
                        token      : chatroom.token,
                        sender     : 'system'
                    }).serialize());
                }
            } else {
                this.logger.warn(`User ${user.name}#${user.id} tried to send message to non-existent chatroom: ${user.activeRoomToken}`);
                user.send(new Message({
                    messageType: Message.messageType.ERROR,
                    message    : 'Chatroom not found',
                    token      : user.activeRoomToken,
                    sender     : 'system'
                }).serialize());
            }
        } else {
            this.logger.warn(`User ${user.name}#${user.id} tried to send message without active chatroom`);
            user.send(new Message({
                messageType: Message.messageType.ERROR,
                message    : 'No active chatroom selected',
                token      : user.activeRoomToken,
                sender     : 'system'
            }).serialize());
        }
    }

    /**
     * @param {User} user - The user
     * @param {string} token
     */
    chatroomJoin(user, token) {
        if (token) {
            const chatroom = this.chatrooms.get(token);
            if (chatroom) {
                if (chatroom.hasUser(user.id)) {
                    user.setActiveRoom(token);
                    user.send(new Message({
                        messageType: Message.messageType.JOINED,
                        message    : `User ${user.name}#${user.id} joined the chatroom`,
                        chatRoom   : chatroom.id,
                        token      : chatroom.token,
                        sender     : user.name
                    }).serialize());
                    chatroom.getHistory(user.id).then(history => {
                        user.send(new Message({
                            messageType: Message.messageType.HISTORY,
                            message    : JSON.stringify(history),
                            token      : chatroom.token,
                            sender     : user.name
                        }).serialize());
                    });
                    chatroom.broadcast(new Message({
                        messageType: Message.messageType.SYSTEM,
                        message    : `User ${user.name}#${user.id} joined the chatroom`,
                        token      : chatroom.token,
                        sender     : user.name
                    }), user.id);
                    this.logger.log(`User ${user.name}#${user.id} joined to chatroom: Name: ${chatroom.name} Token: ${token}`);
                } else {
                    this.logger.warn(`User ${user.name}#${user.id} tried to join to chatroom they aren't in: ${token}`);
                    user.send(new Message({
                        messageType: Message.messageType.ERROR,
                        message    : 'You are not a member of this chatroom',
                        token      : chatroom.token,
                        sender     : 'system'
                    }).serialize());
                }
            } else {
                this.logger.warn(`User ${user.name}#${user.id} tried to join to non-existent chatroom: ${token}`);
                this.logger.warn(this.chatrooms.keys());
                user.send(new Message({
                    messageType: Message.messageType.ERROR,
                    message    : 'Chatroom not found',
                    token      : token,
                    sender     : 'system'
                }).serialize());
            }
        } else {
            this.logger.warn(`User ${user.name}#${user.id} tried to join to undefined chatroom`);
        }

    }

    /**
     * @param {User} user - The user
     * @param {string} token - Target chatroom ID
     */
    chatroomLeave(user, token) {
        if (token) {
            const chatroom = this.chatrooms.get(token);
            if (chatroom) {
                if (chatroom.hasUser(user.id)) {
                    user.setActiveRoom(null);
                    chatroom.broadcast(new Message({
                        messageType: Message.messageType.LEFT,
                        message    : `User ${user.name}#${user.id} left from the chatroom`,
                        chatRoom   : chatroom.id,
                        token      : chatroom.token,
                        sender     : user.name
                    }), user.id);
                    this.logger.log(`User ${user.name}#${user.id} left from chatroom Name: ${chatroom.name} Token: ${token}`);
                } else {
                    this.logger.warn(`User ${user.name}#${user.id} tried to leave from chatroom they aren't in: ${token}`);
                    user.send(new Message({
                        messageType: Message.messageType.ERROR,
                        message    : 'You are not a member of this chatroom',
                        token      : chatroom.token,
                        sender     : 'system'
                    }).serialize());
                }
            } else {
                this.logger.warn(`User ${user.name}#${user.id} tried to leave from non-existent chatroom: ${token}`);
                user.send(new Message({
                    messageType: Message.messageType.ERROR,
                    message    : 'Chatroom not found',
                    token      : token,
                    sender     : 'system'
                }).serialize());
            }
        } else {
            this.logger.warn(`User ${user.name}#${user.id} tried to leave from undefined chatroom`);
        }
    }

    pingAllClients() {
        this.users.forEach((user) => {
            if (user.isConnected()) {
                user.ping();
            }
        });
    }
}

module.exports = ChatServer;
