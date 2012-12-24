
/*
 * GET home page.
 */

exports.index = function(req, res){
    /*
     Regenerate session to ensure we don't reuse old session. Regenerate also updates session in Redis/Memory store.
     So this helps clean up old stuff when we upgrade the server that has multiple-instances + using sticky-session.
     */
    req.session.regenerate(function(err) {
        res.render('index');
    });
};