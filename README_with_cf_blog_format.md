One of the most common things people build on Node.js are real-time apps like chat apps, social networking apps etc. There are plenty of examples showing how to build such apps on the web, but it’s hard to find an example that shows how to deal with real-time apps that are scaled and are running with multiple instances. You will need to deal with issues like sticky sessions, scale-up/down, instance crash/restart, and more for apps that will scale. This post will show you how to manage these scaling requirements.

***
## Chat App
The main objective of this project is to build a simple chat app and focus on tackling such issues. Specifically, we will be building a simple Express, Socket.io and Redis-based Chat app that should meet the following objectives:

1. Chat server should run with multiple instances.
2. The user login should be saved in a session.
    * If the user refreshes the browser, he should be logged back in.
    * Socket.io should get user info from the session before sending chat messages.
    * Socket.io should only connect if user is already logged in.
3. Reconnect: While the user is chatting, if the server-instance to which he is connected goes down / is restarted / scaled-down, the user should be reconnected to an available instance and recover the session.

***Chat app's Login page:***

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/chatAppPage1.png" height="" width="450px" />
</p>

***Chat app's Chat page:***
<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/chatAppPage2.png" height="" width="450px" />
</p>

<br>
***Along the way, we will cover:***

1. How to use Socket.io and Sticky Sessions
2. How to use Redis as a session store
3. How to use Redis as a pubsub service
4. How to use sessions.sockets.io to get session info (like user info) from Express sessions
5. How to configure Socket.io client and server to properly reconnect after one or more server instances goes down (i.e. has been restarted / scaled down / has crashed)


***
## Socket.io & Sticky Sessions ##

<a href='http://socket.io/' target='_blank'>Socket.io</a> is one of the earliest and most popular Node.js modules to help build real-time apps like chat, social networking etc. (note: <a href='https://github.com/sockjs/sockjs-client' target='_blank'>SockJS</a> is another popular library similar to Socket.io).

When you run such a server in a cloud that has a load-balancer/reverse proxy, routers etc, you need to configure it to work properly, especially when you scale the server to use multiple instances.

One of the constraints Socket.io, SockJS and similar libraries have is that they need to continuously talk to the ***same instance*** of the server. They work perfectly well when there is only 1 instance of the server.

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/socketio1Instance.png" height="300px" width="450px" />
</p>

When you scale your app in a cloud environment, the load balancer (Nginx in the case of Cloud Foundry) will take over, and the requests will be sent to different instances causing Socket.io to break.

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/socketioBreaks.png" height="300px" width="450px" />
</p>

To help in such situations, load balancers have a feature called 'sticky sessions' aka 'session affinity'. The main idea is that if this property is set, then after the first load-balanced request, all the following requests will go to the same server instance.

In Cloud Foundry, cookie-based sticky sessions are enabled for apps that set the cookie **jsessionid**.

Note: **jsessionid** is the cookie name commonly used to track sessions in Java/Spring applications. Cloud Foundry is simply adopting that as the sticky session cookie for all frameworks.

So, all the apps need to do is to set a cookie with the name **jsessionid** to make socket.io work.

<pre>
/**
* Use cookieParser and session middlewares together.
* By default Express/Connect app creates a cookie by name 'connect.sid'.But to scale Socket.io app,
* make sure to use cookie name 'jsessionid' (instead of connect.sid) use Cloud Foundry's 'Sticky Session' feature.
* W/o this, Socket.io won't work if you have more than 1 instance.
* If you are NOT running on Cloud Foundry, having cookie name 'jsessionid' doesn't hurt - it's just a cookie name.
*/
app.use(cookieParser);
app.use(express.session({store:sessionStore, key:'jsessionid', secret:'your secret here'}));
</pre>

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/socketioWorks.png" height="300px" width="450px" />
</p>

In the above diagram, when you open the app,

1. Express sets a session cookie with name **jsessionid**.
2. When socket.io connects, it uses that same cookie and hits the load balancer
3. The load balancer always routes it to the same server that the cookie was set in.

***
## Sending session info to Socket.io

Let's imagine that the user is logging in via Twitter or Facebook, or we implement a regular login screen. We are storing this information in a session after the user has logged in.

<pre>
app.post('/login', function (req, res) {
    //store user info in session after login.
    req.session.user = req.body.user;
    ...
    ...
});
</pre>

Once the user has logged in, we connect via socket.io to allow chatting. However, socket.io doesn't know who the user is and whether he is actually logged in before sending chat messages to others.

That's where the `sessions.sockets.io` library comes in. It's a very simple library that's a wrapper around socket.io. All it does is grab session information during the handshake and then pass it to socket.io's `connection` function.

<pre>
//With just Socket.io..
io.sockets.on('connection', function (socket) {
    //do pubsub here
    ...
})

//But with sessions.sockets.io, you'll get session info

/*
 Use SessionSockets so that we can exchange (set/get) user data b/w sockets and http sessions
 Pass 'jsessionid' (custom) cookie name that we are using to make use of Sticky sessions.
 */
var SessionSockets = require('session.socket.io');
var sessionSockets = new SessionSockets(io, sessionStore, cookieParser, 'jsessionid');

sessionSockets.on('connection', function (err, socket, session) {

    //get info from session
    var user = session.user;

    //Close socket if user is not logged in
    if (!user)
        socket.close();

    //do pubsub
    socket.emit('chat', {user: user, msg: 'logged in'});
    ...
});
</pre>

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/sendingSession2SocketIO.png" height="300px" width="450px" />
</p>

***
## Redis as a session store

So far so good... but Express stores these sessions in MemoryStore (by default). MemoryStore is simply a Javascript object - it will be in memory as long as the server is up. If the server goes down, all the session information of all users will be lost!

We need a place to store this outside of our server, but it should also be very fast to retrieve. That's where Redis as a session store come in.

Let's configure our app to use Redis as a session store as below.

<pre>
/*
 Use Redis for Session Store. Redis will keep all Express sessions in it.
 */
var redis = require('redis');
var RedisStore = require('connect-redis')(express);
var rClient = redis.createClient();
var sessionStore = new RedisStore({client:rClient});


  //And pass sessionStore to Express's 'session' middleware's 'store' value.
     ...
     ...
app.use(express.session({store: sessionStore, key: 'jsessionid', secret: 'your secret here'}));
     ...
</pre>

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/redisAsSessionStore.png" height="300px" width="450px" />
</p>

With the above configuration, sessions will now be stored in Redis. Also, if one of the server instances goes down, the session will still be available for other instances to pick up.

## Socket.io as pub-sub server

So far with the above setup our sessions are taken care of - but if we are using socket.io's default pub-sub mechanism, it will work only for 1 sever instance.
i.e. if user1 and user2 are on server instance #1, they can both chat with each other. If they are on different server instances they cannot do so.

<pre>
sessionSockets.on('connection', function (err, socket, session) {
    socket.on('chat', function (data) {
        socket.emit('chat', data); //send back to browser
        socket.broadcast.emit('chat', data); // send to others
    });

    socket.on('join', function (data) {
        socket.emit('chat', {msg: 'user joined'});
        socket.broadcast.emit('chat', {msg: 'user joined'});
    });
}
</pre>

***
## Redis as a PubSub service

In order to send chat messages to users across servers we will update our server to use Redis as a PubSub service (along with session store). Redis *natively supports pub-sub operations*. All we need to do is to create a publisher, a subscriber and a channel and we will be good.

<pre>
//We will use Redis to do pub-sub

/*
 Create two redis connections. A 'pub' for publishing and a 'sub' for subscribing.
 Subscribe 'sub' connection to 'chat' channel.
 */
var sub = redis.createClient();
var pub = redis.createClient();
sub.subscribe('chat');


sessionSockets.on('connection', function (err, socket, session) {
    socket.on('chat', function (data) {
        pub.publish('chat', data);
   });

    socket.on('join', function (data) {
        pub.publish('chat', {msg: 'user joined'});
    });

    /*
     Use Redis' 'sub' (subscriber) client to listen to any message from Redis to server.
     When a message arrives, send it back to browser using socket.io
     */
    sub.on('message', function (channel, message) {
        socket.emit(channel, message);
    });
}

</pre>

The app's architecture will now look like this:

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/redisAsSSAndPS.png" height="300px" width="500px" />
</p>

***
## Handling server scale-down / crashes / restarts

Our app will work fine as long as all the server instances are running.  What happens if the server is restarted or scaled down or one of the instances crash? How do we handle that?

Let's first understand what happens in that situation.

The code below simply connects a browser to server and listens to various socket.io events.

<pre>
 /*
  Connect to socket.io on the server (***BEFORE FIX***).
  */
 var host = window.location.host.split(':')[0];
 var socket = io.connect('http://' + host);

 socket.on('connect', function () {
     console.log('connected');
 });
 socket.on('connecting', function () {
     console.log('connecting');
 });
 socket.on('disconnect', function () {
     console.log('disconnect');
 });
 socket.on('connect_failed', function () {
     console.log('connect_failed');
 });
 socket.on('error', function (err) {
     console.log('error: ' + err);
 });
 socket.on('reconnect_failed', function () {
     console.log('reconnect_failed');
 });
 socket.on('reconnect', function () {
     console.log('reconnected ');
 });
 socket.on('reconnecting', function () {
     console.log('reconnecting');
 });
</pre>

While the user is chatting, if we restart the app **on localhost or on a single host**, socket.io attempts to reconnect multiple times (based on configuration) to see if it can connect. If the server comes up with in that time, it will reconnect. So we see the below logs:

<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/reconnectOn1server.png" height="300px" width="600px" />
</p>

If the user is chatting on the same app that's running ***on Cloud Foundry AND with multiple instances***, and if we restart the server (say using `vmc restart redispubsub`) then we'll see the following log:
<p align='center'>
<img src="https://github.com/rajaraodv/redispubsub/raw/master/pics/reconnectOnMultiServer.png" height="400px" width="600px" />
</p>

You can see that in the above logs, after the server comes back up, socket.io client (running in the browser) isn't able to connect to socket.io server (running on Node.js in the server).

This is because, once the server is restarted on Cloud Foundry, ***instances are brought up as if they are brand-new server instances with different IP addresses and different ports and so `jsessionid` is no-longer valid***. That in turn causes the load balancer to *load balance* socket.io's reconnection requests (i.e. they are sent to different server instances) causing the socket.io server not to properly handshake and consequently to throw `client not handshaken` errors!

### OK, let's fix that reconnection issue

First, we will disable socket.io's default "reconnect" feature, and then implement our own reconnection feature.

In our custom reconnection function, when the server goes down, we'll make a dummy HTTP-get call to index.html every 4-5 seconds. If the call succeeds, we know that the (Express) server has already set ***jsessionid*** in the response. So, then we'll call socket.io's reconnect function. This time because jsessionid is set, socket.io's handshake will succeed and the user will get to continue chatting happily.

<pre>
/*
 Connect to socket.io on the server (*** FIX ***).
 */
var host = window.location.host.split(':')[0];

//Disable Socket.io's default "reconnect" feature
var socket = io.connect('http://' + host, {reconnect: false, 'try multiple transports': false});
var intervalID;
var reconnectCount = 0;
...
...
socket.on('disconnect', function () {
    console.log('disconnect');

    //Retry reconnecting every 4 seconds
    intervalID = setInterval(tryReconnect, 4000);
});
...
...


/*
 Implement our own reconnection feature.
 When the server goes down we make a dummy HTTP-get call to index.html every 4-5 seconds.
 If the call succeeds, we know that (Express) server sets ***jsessionid*** , so only then we try socket.io reconnect.
 */
var tryReconnect = function () {
    ++reconnectCount;
    if (reconnectCount == 5) {
        clearInterval(intervalID);
    }
    console.log('Making a dummy http call to set jsessionid (before we do socket.io reconnect)');
    $.ajax('/')
        .success(function () {
            console.log("http request succeeded");
            //reconnect the socket AFTER we got jsessionid set
            socket.socket.reconnect();
            clearInterval(intervalID);
        }).error(function (err) {
            console.log("http request failed (probably server not up yet)");
        });
};

</pre>


In addition, since the jsessionid is invalidated by the load balancer, we can't create a session with the same jsessionid or else the sticky session will be ignored by the load balancer. So on the server, when the dummy HTTP request comes in, we will ***regenerate*** the session to remove the old session and sessionid and ensure everything is afresh before we serve the response.

<pre>
//Instead of..
exports.index = function (req, res) {
    res.render('index', { title: 'RedisPubSubApp', user: req.session.user});
};

//Use this..
exports.index = function (req, res) {
    //Save user from previous session (if it exists)
    var user = req.session.user;

    //Regenerate new session & store user from previous session (if it exists)
    req.session.regenerate(function (err) {
        req.session.user = user;
        res.render('index', { title: 'RedisPubSubApp', user: req.session.user});
    });
};

</pre>

***
## Running / Testing it on Cloud Foundry ##

* Clone the app to `redispubsub` folder
* `cd redispubsub`
* `npm install` and follow the below instructions to push the app to Cloud Foundry

<pre>

[~/success/git/redispubsub]
> vmc push redispubsub
Instances> 4       <----- Run 4 instances of the server

1: node
2: other
Framework> node

1: node
2: node06
3: node08
4: other
Runtime> 3  <---- Choose Node.js 0.8v

1: 64M
2: 128M
3: 256M
4: 512M
Memory Limit> 64M

Creating redispubsub... OK

1: redispubsub.cloudfoundry.com
2: none
URL> redispubsub.cloudfoundry.com  <--- URL of the app (choose something unique)

Updating redispubsub... OK

Create services for application?> y

1: blob 0.51
2: mongodb 2.0
3: mysql 5.1
4: postgresql 9.0
5: rabbitmq 2.4
6: redis 2.6
7: redis 2.4
8: redis 2.2
What kind?> 6 <----- Select & Add Redis v2.6 service

Name?> redis-e9771 <-- This is just a random name for Redis service

Creating service redis-e9771... OK
Binding redis-e9771 to redispubsub... OK
Create another service?> n

Bind other services to application?> n

Save configuration?> n

Uploading redispubsub... OK
Starting redispubsub... OK
Checking redispubsub... OK

</pre>

* Once the server is up, open up multiple browsers and go to `<appname>.cloudfoundry.com`
* Start chatting

***
#### Test 1

* Refresh the browser
* You should automatically be logged in


#### Test 2

* Open up JS debugger (in Chrome, do `cmd + alt +j`)
* Restart the server by running `vmc restart <appname>`
* Once the server restarts, Socket.io should automatically reconnect
* You should be able to chat after the reconnection

***
## General Notes
* Github location: <a href='https://github.com/rajaraodv/redispubsub' target='_blank'>https://github.com/rajaraodv/redispubsub</a>
* If you don't have a Cloud Foundry account, sign up for it <a href='https://my.cloudfoundry.com/signup' target='_blank'>here</a>
* Check out Cloud Foundry getting started <a href='http://docs.cloudfoundry.com/getting-started.html' target='_blank'>here</a> and install the `vmc` Ruby command line tool to push apps.

* To install the ***latest alpha or beta*** `vmc` tool run: `sudo gem install vmc --pre`


#### Credits

Front end UI: <a href="https://github.com/steffenwt/nodejs-pub-sub-chat-demo">https://github.com/steffenwt/nodejs-pub-sub-chat-demo</a></p>
