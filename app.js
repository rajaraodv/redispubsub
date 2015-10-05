var express = require('express');
var path = require('path');
var redis = require('redis');
var favicon = require('serve-favicon');
var logger = require('morgan');
var CookieParser = require('cookie-parser');
var SECRET = 'hellonihao';
var COOKIENAME = 'hello';
var cookieParser = CookieParser(SECRET);
var bodyParser = require('body-parser');
var ExpressSession = require('express-session');
var connectRedis = require('connect-redis');
var RedisStore = connectRedis(ExpressSession);
var rClient = redis.createClient();
var sessionStore = new RedisStore({client: rClient});

var app = express();
var session = ExpressSession({
  store: sessionStore,
  secret: SECRET,
  resave: true,
  saveUninitialized: true
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser);
app.use(session);
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev'));

// setup routes
var routes = require('./routes/index');
app.use('/', routes);



// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

// passing the session store and cookieParser
app.sessionStore = sessionStore;
app.cookieParser = cookieParser;
app.session = session;

module.exports = app;
