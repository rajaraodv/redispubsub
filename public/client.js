$(document).ready(function () {

    // show join box
    $('#ask').show();
    $('#ask input').focus();

    // join on enter
    $('#ask input').keydown(function (event) {
        if (event.keyCode == 13) {
            $('#ask a').click();
        }
    })

    /*
     When the user joins, hide the join-field, display chat-widget and also call 'join' function that
     initializes Socket.io and the entire app.
     */
    $('#ask a').click(function () {
        join($('#ask input').val());
        $('#ask').hide();
        $('#channel').show();
        $('input#message').focus();
    });

    function join(name) {
        /*
         Connect to socket.io on the server.
         */
        var host = window.location.host.split(':')[0];
        var socket = io.connect('http://' + host);

        /*
         When the user Logs in, send a HTTP POST to server w/ user name.
         */
        $.post('/user', {"user":name})
            .success(function () {
                console.log("success");
                // send join message
                socket.emit('join', $.toJSON({ }));
            }).error(function () {
                console.log("error");
            });

        var container = $('div#msgs');

        /*
         When a message comes from the server, format, colorize it etc. and display in the chat widget
         */
        socket.on('chat', function (msg) {
            var message = $.evalJSON(msg);

            var action = message.action;
            var struct = container.find('li.' + action + ':first');

            if (struct.length < 1) {
                console.log("Could not handle: " + message);
                return;
            }

            // get a new message view from struct template
            var messageView = struct.clone();

            // set time
            messageView.find('.time').text((new Date()).toString("HH:mm:ss"));

            switch (action) {
                case 'message':
                    var matches;
                    // someone starts chat with /me ...
                    if (matches = message.msg.match(/^\s*[\/\\]me\s(.*)/)) {
                        messageView.find('.user').text(message.user + ' ' + matches[1]);
                        messageView.find('.user').css('font-weight', 'bold');
                        // normal chat message
                    } else {
                        messageView.find('.user').text(message.user);
                        messageView.find('.message').text(': ' + message.msg);
                    }
                    break;
                case 'control':
                    messageView.find('.user').text(message.user);
                    messageView.find('.message').text(message.msg);
                    messageView.addClass('control');
                    break;
            }

            // color own user:
            if (message.user == name) messageView.find('.user').addClass('self');

            // append to container and scroll
            container.find('ul').append(messageView.show());
            container.scrollTop(container.find('ul').innerHeight());
        });

        /*
         When the user creates a new chat message, send it to server via socket.emit w/ 'chat' event/channel name
         */
        $('#channel form').submit(function (event) {
            event.preventDefault();
            var input = $(this).find(':input');
            var msg = input.val();
            socket.emit('chat', $.toJSON({action:'message', msg:msg}));
            input.val('');
        });

    }
});