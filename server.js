process.env.TZ = 'Europe/Budapest';
const ChatServer = require('./chat-server/ChatServer');
const chatServer = new ChatServer();
process.on('SIGINT', () => {
    chatServer.logger.log('Server shutting down...');
    chatServer.server.close(() => {
        chatServer.logger.log('Server closed');
        process.exit(0);
    });
});