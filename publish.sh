npm run build
cp -R dist/. /var/www/discord-mixtape-bot
cp client_secret.json /var/www/discord-mixtape-bot
pm2 restart mixtape-bot
