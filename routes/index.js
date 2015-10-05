var express = require('express');
var router = express.Router();

function renderHomePage(req, res) {
    var serverName = process.env.VCAP_APP_HOST ? process.env.VCAP_APP_HOST + ":" + process.env.VCAP_APP_PORT : 'localhost:3000';
    //save user from previous session (if it exists)
    var user = req.session.user;
    //regenerate new session & store user from previous session (if it exists)
    req.session.regenerate(function (err) {
        req.session.user = user;
        console.log('req.session.user ' + req.session.user);
        res.render('index', { title:'Express', server:serverName, user:req.session.user});
    });
}

/* GET home page. */
router.get('/', renderHomePage);

/*
 When the user logs in (in our case, does http POST w/ user name), store it
 in Express session (which inturn is stored in Redis)
 */
router.post('/user', function (req, res) {
    req.session.user = req.body.user;//set username to session
   	renderHomePage(req, res);
});

router.get('/logout', function(req, res) {
    req.session.destroy();
    res.redirect('/');
});


module.exports = router;
