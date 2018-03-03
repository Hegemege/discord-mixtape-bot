var path = require("path");

module.exports = {
    entry: "./main.js",
    target: "node",
    output: {
        path: path.join(__dirname, "dist"),
        filename: "discord-mixtape-bot.js"
    }
}