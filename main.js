const Discord = require("discord.js");
const logger = require("winston");
const auth = require("./auth.json");
const config = require("./config.json");

const path = require("path");
const Datastore = require("nedb-core");

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    colorize: true
});
logger.level = "debug";

// Initialize Discord Bot
let bot = new Discord.Client();

// Initialize a db to store the links
mixtapeDB = new Datastore({ 
    filename: path.join(__dirname, "/db/mixtape.db"), 
    autoload: true, 
    timestampData: true
});

// Data model to save in the DB
class MixtapeEntry {
    constructor(url) {
        this.url = url;
        this.archived = false;
    }
}

// Regularly clean up old entries 
setInterval(() => {
    let twoMonthsAgo = Date.now() - config.cleanupInterval * 60 * 60 * 1000;
    mixtapeDB.remove( {
        "createdAt": { 
            $lt: twoMonthsAgo 
        }, "archived": true
    }, { multi: true }, (err, docs) => {
        //logger.info("Deleted " + docs.length + " old entries.");
    });
}, (+config.cleanupInterval) * 60 * 60 * 1000); // cleanupInterval given in hours. Note: be mindful of int32 limitation

// Set up the playlist creation interval
setInterval(() => {
    // TODO: Create youtube playlist and post it
}, (+config.mixtapeInterval) * 60 * 60 * 1000); // mixtapeInterval given in hours

// Login with the token
logger.info("Connecting...");
bot.login(auth.token)
    .then(() => {
        logger.info("Connected, logged in as:");
        logger.info(bot.user.username + "#" + bot.user.discriminator + " (" + bot.user.id + ")");
    });

// Define node routes
bot.on("message", message => {
    // Validate any message first by checking the first symbol to only interpret commands
    if (message.content.substring(0, 1) !== "!") return;

    // Validate that the message originated from a channel that is configured for the bot to operate in
    if (config.activeChannels.indexOf(message.channel.id) === -1) return;

    // Parse the message's command
    let args = message.content.substring(1).split(" ");
    let command = args[0];
    args = args.splice(1);

    switch(command) {
        // Add a link
        case "add":
        case "insert":
        case "link":
            // If successful, add reaction to the message
            message.react("✅");
            break;

        case "remove":
        case "delete":
            break;
    }
    
});