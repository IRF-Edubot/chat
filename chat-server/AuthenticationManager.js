const axios = require('axios');

class AuthenticationManager {
    /**
     * @param {string} url
     * @param {Logger} logger
     */
    constructor(url, logger) {
        this.url = url;
        this.logger = logger;
    }

    /**
     * @async
     * @param {string} sessionToken
     * @param {string} command
     * @property {Object} response.data.answer.appSettings
     * @property {Object} response.data.answer.inventory
     * @returns {Promise<Object>}
     */
    async authenticate(sessionToken, command = 'getUserProfile') {
        const returnData = {success: false};
        try {
            const postData = {
                sessionToken,
                command,
                includeChatbase: false,
                'duck'         : {
                    'duckID'        : 'duckNode',
                    'duckVersion'   : 'duckNode',
                    'duckType'      : 'node',
                    'deviceTimeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
                }
            };
            const response = await axios.post(this.url, postData);
            if (response.data && response.data.error === false) {
                delete response.data.answer.appSettings;
                delete response.data.answer.inventory;
                this.logger.log(`Authentication successful: ${JSON.stringify(response.data.answer, null, 4)}`);
                returnData.success = true;
                returnData.userData = response.data.answer;
            } else {
                this.logger.warn(`Authentication failed: ${JSON.stringify(response.data.answer, null, 4)}`);
            }
        } catch (error) {
            this.logger.error(`Authentication error: ${error}`);
        }
        return returnData;
    }
}

module.exports = AuthenticationManager;