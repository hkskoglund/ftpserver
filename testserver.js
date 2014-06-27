/* global console:true, require: true, setTimeout: true*/

var net = require('net');
var sockets = [];
var server = net.createServer();
server.on('connection',function _onSocketConncetion(socket)
          {
              console.log('Socket connected',socket.address());
              sockets.push(socket);
          });

server.on('error',function _onservererror(err) { console.error('error',err); });

server.on('close', function _onserverclose() { console.log('server closed!'); });

server.listen(8125,'127.0.0.1',function _onserverlisten () {
     console.log('server listening on ',server.address());
});

setTimeout(function _timeoutForecedClose() {
    console.log("Forcing server close by destroying sockets",sockets.length);
    server.once('close',function () { console.log('Server close was forced'); });
    server.close();
    sockets.forEach(function (socket) { socket.destroy(); } );

                    },20000);

