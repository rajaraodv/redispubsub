var express = require('express');
var http = require('http');

var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);

//Set Socket.io's log level to 1 (info). Default is 3 (debugging)
io.set('log level', 1);

//Set xhr-polling as WebSocket is not supported by CF
io.set("transports", ["xhr-polling"]);

var redis = require('redis');

/*
 Create RedisStore and store Express sessions w/in Redis.
 */
var RedisStore = require('connect-redis')(express),
    sessionStore = new RedisStore({client:redis.createClient()}),
    cookieParser = express.cookieParser('your secret sauce');

app.configure(function () {
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());

    /*
     Use cookieParser and session middlewares together.

     By default Express/Connect app creates a cookie by name 'connect.sid'.But to scale Socket.io app,
     make sure to use cookie name 'jsessionid' (instead of connect.sid) use Cloud Foundry's 'Sticky Session' feature.
     W/o this, Socket.io won't work if you have more than 1 instance.
     If you are NOT running on Cloud Foundry, having cookie name 'jsessionid' doesn't hurt - it's just a cookie name.
     */
    app.use(cookieParser);
    app.use(express.session({store:sessionStore, key:'jsessionid', secret:'your secret sauce'}));

    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

app.configure('development', function () {
    app.use(express.errorHandler());
});

/*
 Use SessionSockets so that we can exchange (set/get) user data b/w sockets and http sessions
 Pass 'jsessionid' (custom) cookie name that we are using to make use of Sticky sessions.
 */
var SessionSockets = require('session.socket.io');
var sessionSockets = new SessionSockets(io, sessionStore, cookieParser, 'jsessionid');

server.listen(3000);

/*
 Create two redis connections. A 'pub' for publishing and a 'sub' for subscribing.
 Subscribe 'sub' connection to 'chat' channel.
 */
var sub = redis.createClient();
var pub = redis.createClient();
sub.subscribe('chat');


sessionSockets.on('connection', function (err, socket, session) {
    sub.on('message', function (channel, message) {
        socket.emit(channel, message);
    });

    // Receive message from browser
    socket.on('chat', function (data) {
        var msg = JSON.parse(data);
        if (!msg.msg || msg.msg === '') return;

        var reply = JSON.stringify({action:'message', user:session.user, msg:msg.msg });
        pub.publish('chat', reply);
    });

    //Listen & wait for user to Join. Store user info in session. Broadcast user has joined
    socket.on('join', function (data) {
        var msg = JSON.parse(data);
        //store user to session (which itself is stored in Redis)
        session.user = msg.user;

        //broadcast a user logged in
        var joinMessage = JSON.stringify({action:'control', user:session.user, msg:' joined the channel' });
        pub.publish('chat', joinMessage);
    });

    //When user logs out, broadcast that.
    socket.on('disconnect', function () {
        var leaveMessage = JSON.stringify({action:'control', user:session.user, msg:' left the channel' });
        pub.publish('chat', leaveMessage);
    });
});
