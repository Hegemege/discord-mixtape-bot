var path = require("path");

module.exports = {
    entry: "./main.js",
    target: "node",
    output: {
        path: path.join(__dirname, "dist"),
        filename: "discord-mixtape-bot.js"
    },
    node: {
        __dirname: false,
        __filename: false,
        fs: "empty",
        net: "empty",
        tls: "empty"
    }
}