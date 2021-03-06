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

// Initialize a db to store the video links
videosDB = new Datastore({ 
    filename: path.join(__dirname, "/db/videos.db"), 
    autoload: true, 
    timestampData: true,
    autoCompactInterval: 60 * 60 * 1000 // Every hour
});

// Initialize a db to store all created playlists
playlistDB = new Datastore({
    filename: path.join(__dirname, "/db/playlist.db"),
    autoload: true,
    timestampData: true,
    autoCompactInterval: 60 * 60 * 1000 // Every hour
});

// Data model to save in the videosDB
class VideoEntry {
    constructor(videoId, playlistId, playlistItemId) {
        this.id = videoId; // Youtube video id
        // The url can be constructed easily from the id
        //this.url = "https://youtube.com/watch?v=" + this.id
        this.playlistId = playlistId;
        this.playlistItemId = playlistItemId; // Used to uniquely identify this entry on the playlist
        this.archived = false; // Whether the mixtape the video belongs to has been published
    }
}

// Data model to save in playlistDB
class Playlist {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        // The url can be constructed easily from the id
        //this.url = "https://youtube.com/watch?v=" + this.id
        this.released = false;
    }
}

let cleanupInterval = (+config.cleanupInterval) * 60 * 60 * 1000; // cleanupInterval given in hours.
let checkInterval = (+config.mixtapeCheckInterval) * 60 * 1000 // mixtapeInterval given in minutes
let releaseInterval = (+config.mixtapeReleaseInterval) * 60 * 60 * 1000;
let oldVideosThreshold = (+config.deleteOldVideosThreshold) * 60 * 60 * 1000; // Given in hours. Note: be aware of int32 limitations
let requiredVideosBeforeRelease = (+config.requiredVideosForMixtape);

if (config.devMode) {
    cleanupInterval = 5 * 1000;
    checkInterval = 5 * 1000;
    releaseInterval = 60 * 1000;
    oldVideosThreshold = 5 * 60 * 1000;
    requiredVideosBeforeRelease = 3;
}

// Regularly clean up old, archived entries 
setInterval(() => {
    let monthAgo = Date.now() - oldVideosThreshold; 
    videosDB.remove( {
        "createdAt": { 
            $lt: new Date(monthAgo) 
        }, "archived": true
    }, { multi: true }, (err, docs) => {
        if (docs.length > 0) {
            logger.info("Deleted " + docs.length + " old entries.");
        }
    });
}, cleanupInterval); 

// Set up the mixtape publish / update interval
setInterval(() => {
    // Check if it has been longer than the given release interval for a mixtape 
    // (there should only be one in the DB with released = false)
    let lastRelease = Date.now() - releaseInterval; // Given in hours.
    playlistDB.find(
        { "updatedAt": { $lt: new Date(lastRelease) }, "released": false },
        (err, docs) => {
            // First check if there are no releases that are old enough
            if (docs.length === 0) {
                createInitialPlaylist(() => {});
                return;
            } 

            if (docs.length !== 1) {
                logger.info("There are multiple old unreleased mixtapes. Releasing all of them");
            }

            for (let doc of docs) {
                // We found a mixtape that can be released!
                // Send a message to the channel with the mixtape's URL and set it as released
                // Also create a new mixtape playlist ready for submissions

                // If there are not enough videos posted, do not send the message but only refresh the playlist in DB
                videosDB.find({ "playlistId": doc.id }, (err, docs) => {
                    if (err) return;

                    // Only release if there are a minimum number of videos on the playlist
                    if (docs.length >= requiredVideosBeforeRelease) {
                        // Form the url using the first video and the list id
                        let firstVideo = docs[0];
                        let mixtapeUrl = "https://youtube.com/watch?v=" + firstVideo.id + "&list=" + doc.id; // Not to be confused with _id given by NeDB.
                        let channelMessage = "🔥Hot🔥new🔥mixtape🔥 \"" + doc.name + "\" is now available, enjoy! " + mixtapeUrl + ". New additions from now on will be released in the next 🔥mixtape🔥";
        
                        var channel = bot.channels.get(config.mixtapeReleaseChannel);
                        channel.send(channelMessage);
        
                        // Set as released
                        playlistDB.update(
                            { "id": doc.id },
                            { $set: { "released": true } },
                            {},
                            (err, numAffected) => {
                                if (err) {
                                    console.log("Error updating playlist as released:", err);
                                    return;
                                }
                                // Also set the videos as archived
                                videosDB.update({ "playlistId": doc.id }, { $set: { "archived": true }}, { multi: true }, (err, numaffected) => {});
        
                                // And create a new mixtape
                                playlistDB.count({}, (err, count) => {
                                    createNewPlaylist("Hot Mixtape " + (count + 1) ,(success, playlistId) => {
                                        if (success) {
                                            logger.info("Created playlist with id", playlistId);
                                        } else {
                                            logger.error("Unable to create new playlist");
                                        }
                                    });
                                });
        
                            }
                        );
                    }
                });


            }
        }
    );
}, checkInterval); 

// Login to discord with the token
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

    // Parse the message"s command
    let args = message.content.substring(1).split(" ");
    let command = args[0];
    args = args.splice(1);

    if (args.length !== 1) {
        message.react("❓");
        return;
    }

    args[0] = args[0].replace("<", "").replace(">", "");

    var matches = args[0].match(/http(?:s?):\/\/(?:www\.)?youtu(?:be\.com\/watch\?v=|\.be\/)([\w\-\_]*)(&(amp;)?‌​[\w\?‌​=]*)?/);
    if (!matches) {
        message.react("❓");
        return;
    }

    switch(command) {
        // Add a link
        case "add":
        case "insert":
        case "link":
            // Add the link to the current mixtape
            // Get the playlistId of the current mixtape
            playlistDB.find({ "released": false }, (err, docs) => {
                if (err || docs.length > 1) {
                    if (err) logger.error("Error while retrieving non-released playlists: " + err);

                    // Better way of saying 500 - Internal Server Error
                    message.react("🤖");
                    setTimeout(() => {
                        message.react("🔫");
                    }, 200);
                    return;
                }

                if (docs.length === 0) {
                    createInitialPlaylist((success, playlistId) => {
                        if (success) {
                            logger.info("Adding video " + matches[1] + " to playlist " + playlistId);
                            addToPlaylist(message, matches[1], playlistId);
                        } else {
                            logger.error("Can't create initial playlist");
                            message.react("🤖");
                            setTimeout(() => {
                                message.react("🔫");
                            }, 200);
                            return;
                        }
                    });
                }

                // There is only one unreleased playlist
                // Add the given video there. The video ID can be gound in matches[1];
                if (docs.length === 1) {
                    logger.info("Adding video " + matches[1] + " to playlist " + docs[0].id);
                    addToPlaylist(message, matches[1], docs[0].id);
                }

            });

            break;
        case "remove":
        case "delete":
            // Get the first video with the given id
            let videoId = matches[1];

            videosDB.find({ "id": videoId }, (err, docs) => {
                if (err || !docs || docs.length === 0) {
                    message.react("🚫");
                    return;
                }

                // Delete the first one only
                let doc = docs[0];
                let playlistItemId = doc.playlistItemId;

                // Delete from DB and youtube
                videosDB.remove({ "id": videoId }, (err, numRemoved) => {
                    if (err) {
                        logger.error("Unable to delete video from DB: " + err);
                        message.react("🤖");
                        setTimeout(() => {
                            message.react("🚫");
                        }, 200);
                        return;
                    }

                    logger.info("Deleted video with id " + doc.id);
                    removeFromPlaylist(message, playlistItemId);
                });

                
            });
            break;
        default:
            message.react("❓");
            break;
    }
    
});

/* Helper methods to access the Youtube API */

function createNewPlaylist(name, callback) {
    // Load client secrets from a local file.
    fs.readFile("client_secret.json", function processClientSecrets(err, content) {
        if (err) {
            console.log("Error loading client secret file: " + err);
            return;
        }

        // Authorize a client with the loaded credentials, then call the YouTube API.
        authorize(JSON.parse(content), 
        {
            "params": {
                "part": "snippet,status",
                "onBehalfOfContentOwner": ""
            }, 
            "properties": {
                "id": "",
                "snippet.title": name,
                "snippet.description": "",
                "snippet.tags[]": "",
                "status.privacyStatus": "unlisted"
            }
        }, (client, data) => {
            playlistsInsert(client, data, (success, response) => {
                // If successful, store the new playlist ID into DB
                let playlistId = response.data.id;
                let playlist = new Playlist(playlistId, name);
                playlistDB.insert(playlist);

                callback(success, playlistId);
            })
        });
    });
}

function addToPlaylist(message, videoId, playlistId) {
    // Load client secrets from a local file.
    fs.readFile("client_secret.json", function processClientSecrets(err, content) {
        if (err) {
            console.log("Error loading client secret file: " + err);
            return;
        }

        // Authorize a client with the loaded credentials, then call the YouTube API.
        authorize(JSON.parse(content), 
        {
            "params": {
                "part": "snippet",
                "onBehalfOfContentOwner": ""
            }, 
            "properties": {
                "snippet.playlistId": playlistId,
                "snippet.resourceId.kind": "youtube#video",
                "snippet.resourceId.videoId": videoId,
                "snippet.position": ""
            }
        }, (client, data) => {
            playlistItemsInsert(client, data, (success, response) => {
                // If successful, add reaction to the message
                if (success) {
                    message.react("✅");

                    // Also save the video in the DB
                    let video = new VideoEntry(videoId, playlistId, response.data.id);
                    videosDB.insert(video);
                } else {
                    logger.error("Failed to add video to playlist");
                    logger.error(response.status);
                    logger.error(response.statusText);
                    logger.error(response.data);
                    message.react("🚫");
                }
            })
        });
    });
}

function removeFromPlaylist(message, playlistItemId) {
    // Load client secrets from a local file.
    fs.readFile("client_secret.json", function processClientSecrets(err, content) {
        if (err) {
            console.log("Error loading client secret file: " + err);
            return;
        }

        // Authorize a client with the loaded credentials, then call the YouTube API.
        authorize(JSON.parse(content), 
        {
            "params": {
                "id": playlistItemId,
                "onBehalfOfContentOwner": ""
            }
        }, (client, data) => {
            playlistItemsDelete(client, data, (success, response) => {
                if (success) {
                    logger.info("Youtube response: Video removed from playlist successfully");
                    message.react("✅");
                } else {
                    logger.error("Failed to remove video from playlist");
                    logger.error(response.status);
                    logger.error(response.statusText);
                    logger.error(response.data);
                    message.react("🚫");
                }
            });
        });
    });
}

function createInitialPlaylist(callback) {
    playlistDB.count({}, (err, count) => {
        // If there are in fact no mixtapes yet, let's add one
        if (err) {
            logger.error("Could not get playlistDB count: " + err);
            return;
        }

        if (count === 0) {
            createNewPlaylist("Hot Mixtape 1", (success, playlistId) => {
                if (success) {
                    logger.info("Created playlist with id", playlistId);
                } else {
                    logger.error("Unable to create new playlist");
                }

                callback(success, playlistId);
            });
            return;
        }

        // No need to do anything
    });
}

/* Code from Google dev API on authenticating to youtube */

const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");

var fs = require("fs");
var readline = require("readline");

var SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + "/.credentials/";
var TOKEN_PATH = TOKEN_DIR + "discord-mixtape-bot.json";

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, requestData, callback) {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, function(err, token) {
        if (err) {
            getNewToken(oauth2Client, requestData, callback);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            callback(oauth2Client, requestData);
        }
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, requestData, callback) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES
    });
    console.log("Authorize this app by visiting this url: ", authUrl);
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question("Enter the code from that page here: ", function(code) {
        rl.close();
        oauth2Client.getToken(code, function(err, token) {
            if (err) {
                console.log("Error while trying to retrieve access token", err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            callback(oauth2Client, requestData);
        });
    });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
    try {
        fs.mkdirSync(TOKEN_DIR);
    } catch (err) {
        if (err.code != "EEXIST") {
            throw err;
        }
    }
    fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    console.log("Token stored to " + TOKEN_PATH);
}

/**
 * Remove parameters that do not have values.
 *
 * @param {Object} params A list of key-value pairs representing request
 *                        parameters and their values.
 * @return {Object} The params object minus parameters with no values set.
 */
function removeEmptyParameters(params) {
    for (var p in params) {
        if (!params[p] || params[p] == "undefined") {
            delete params[p];
        }
    }
    return params;
}

/**
 * Create a JSON object, representing an API resource, from a list of
 * properties and their values.
 *
 * @param {Object} properties A list of key-value pairs representing resource
 *                            properties and their values.
 * @return {Object} A JSON object. The function nests properties based on
 *                  periods (.) in property names.
 */
function createResource(properties) {
    var resource = {};
    var normalizedProps = properties;
    for (var p in properties) {
        var value = properties[p];
        if (p && p.substr(-2, 2) == "[]") {
            var adjustedName = p.replace("[]", "");
            if (value) {
                normalizedProps[adjustedName] = value.split(",");
            }
            delete normalizedProps[p];
        }
    }
    for (var p in normalizedProps) {
        // Leave properties that don"t have values out of inserted resource.
        if (normalizedProps.hasOwnProperty(p) && normalizedProps[p]) {
            var propArray = p.split(".");
            var ref = resource;
            for (var pa = 0; pa < propArray.length; pa++) {
                var key = propArray[pa];
                if (pa == propArray.length - 1) {
                    ref[key] = normalizedProps[p];
                } else {
                    ref = ref[key] = ref[key] || {};
                }
            }
        };
    }
    return resource;
}


function playlistsInsert(auth, requestData, callback) {
    var service = google.youtube("v3");
    var parameters = removeEmptyParameters(requestData["params"]);
    parameters["auth"] = auth;
    parameters["resource"] = createResource(requestData["properties"]);
    service.playlists.insert(parameters, function(err, response) {
        if (err) {
            console.log("The API returned an error: " + err);
            callback(false, response);
            return;
        }

        callback(true, response);
    });
}


function playlistItemsInsert(auth, requestData, callback) {
    var service = google.youtube("v3");
    var parameters = removeEmptyParameters(requestData["params"]);
    parameters["auth"] = auth;
    parameters["resource"] = createResource(requestData["properties"]);
    service.playlistItems.insert(parameters, function(err, response) {
        if (err) {
            console.log("The API returned an error: " + err);
            callback(false, response);
            return;
        }
        callback(true, response);
    });
}


function playlistItemsDelete(auth, requestData, callback) {
    var service = google.youtube('v3');
    var parameters = removeEmptyParameters(requestData['params']);
    parameters['auth'] = auth;
    service.playlistItems.delete(parameters, function(err, response) {
        if (err) {
            console.log('The API returned an error: ' + err);
            callback(false, response);
            return;
        }
        callback(true, response);
    });
}