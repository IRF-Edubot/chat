class Logger {
    constructor() {
        this.logEnabled = true;
    }

    log(message, ...messages) {
        if (this.logEnabled) {
            console.log(`\x1b[36m[${new Date().toISOString()}] [INFO]:\x1b[0m\n`, message);
            if (messages.length > 0) {
                console.table(messages);
            }
        }
    }

    error(message, ...messages) {
        if (this.logEnabled) {
            console.error(`\x1b[31m[${new Date().toISOString()}] [ERROR]:\x1b[0m\n`, message);
            if (messages.length > 0) {
                console.table(messages);
            }
        }
    }

    warn(message, ...messages) {
        if (this.logEnabled) {
            console.warn(`\x1b[33m[${new Date().toISOString()}] [WARN]:\x1b[0m\n`, message);
            if (messages.length > 0) {
                console.table(messages);
            }
        }
    }
}

module.exports = Logger;