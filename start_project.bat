@echo off
echo Starting the Node.js server...
start cmd /k "node server.js"

echo Starting the React app...
start cmd /k "npm start"

echo Both processes have been launched.