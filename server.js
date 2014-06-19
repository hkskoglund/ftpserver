/* global console:true, require: true, setTimeout: true*/

'use strict';

var net = require('net');

var COMMAND_PORT_L = 8124;
var LOOPBACK_IP = '127.0.0.1';
var HOST_NAME = 'FAKE FTP_SERVER';

var CRLF = '\r\n', EOL = CRLF;
var SP = ' ';

function FTPServer (configuration)
{
    this.server = net.createServer(this.onconnection.bind(this));

    this.serviceUnavailable = false;

    this.command = {}; // State of command line for control socket

    this.controlSockets = []; // Established control sockets

    this.pendingServiceReadyQueue = []; // Queue of control sockets pending for service ready message
    
    this.configuration = configuration;
    
    if (this.configuration === undefined)
    {
        this.configuration = {};
        this.configuration.name = HOST_NAME;
        this.configuration.port = COMMAND_PORT_L;
        this.configuration.idletimeout = 0;
        console.info('Created default configuration',this.configuration);
    }
    
    console.log("Max conncetions",this.server.maxConnections);

    this.server.maxConnections = this.configuration.maxConnections || 1;

    //this.server.listen(this.configuration.port,this.configuration.host, this.onlistening.bind(this));
}

FTPServer.prototype.cmdFilter = function (element)
{
    return (element.indexOf(this) === 0);
};

FTPServer.prototype.findMatchingCommand = function(command)
{

    if (!command)
    {
        console.error('Undefined or null command, cannot find matching command');
        return ;
    } else
        return Object.getOwnPropertyNames(FTPServer.prototype.COMMAND).filter(this.cmdFilter,command.toUpperCase());

};

// Protocol Intepreter
FTPServer.prototype.serverPI = function (controlSocket) {

    switch (this.command.command)
    {
       case FTPServer.prototype.COMMAND.USER :
            console.log("Got USER command",this.command);
            break;

       default :
            break;
    }

    this.reply(controlSocket,this.REPLY.POSITIVE_COMMAND_NOT_IMPLEMENTED);

};

FTPServer.prototype.processCommandLine = function (controlSocket,dataStr)
{
     var
          commandSplit,
          indexEOL,
          matchingCommands;

     indexEOL = dataStr.indexOf(EOL);

      if (indexEOL === -1) // Not received EOL just append received data to command string
      {
          this.command.line += dataStr;
          return; /* "It should be noted that the server is to take no action until the end of line code is received." http://www.ietf.org/rfc/rfc959.txt p. 46 */
      }

      this.command.line += dataStr.substring(0,indexEOL);

      commandSplit = this.command.line.split(SP);

    console.log("command.line",this.command.line,commandSplit);

    matchingCommands = this.findMatchingCommand(commandSplit[0]);
    console.log('matcing commands',matchingCommands);

     if (!matchingCommands || matchingCommands.length === 0 )
         this.reply(controlSocket,this.REPLY.SYNTAX_ERROR_COMMAND_UNRECOGNIZED);
    else if (matchingCommands.length > 1)
        this.reply(controlSocket,this.REPLY.SYNTAX_ERROR_COMMAND_UNRECOGNIZED,'Ambigous commands '+matchingCommands);
    else {
        this.command.command = matchingCommands[0];
        this.command.arguments = commandSplit.slice(1);
        this.serverPI(controlSocket);
    }

    this.command.line = dataStr.substring(indexEOL+2); // Next command line or "" empty string

   /* if (this.command.line !== '')
        this.processCommandLine(controlSocket,*/
};

FTPServer.prototype.ondata = function (controlSocket,data)
{
     this.processCommandLine(controlSocket,data.toString());

};

FTPServer.prototype.removeSocketFromQueue = function (queue,socket)
{
    var indx = queue.indexOf(socket);
    if (indx !== -1)
        queue.splice(indx,1);
    //else
    //    console.warn('Cannot remove socket from queue',queue,socket);
};

FTPServer.prototype.removeSocketFromDefaultQueues = function(socket)
{
    this.removeSocketFromQueue(this.controlSockets,socket);
    this.removeSocketFromQueue(this.pendingServiceReadyQueue,socket);
};

FTPServer.prototype.onclose = function (socket,had_error)
{
   if (had_error)
       console.error(Date.now(),'Socket had transmission error(s) and is fully closed now',this.getSocketRemoteAddress(socket));
};

FTPServer.prototype.onend = function (controlSocket,data)
{

    console.log('Remote '+this.getSocketRemoteAddress(controlSocket)+' disconnected control connection');

    this.removeControlSocket(controlSocket);
};

FTPServer.prototype.removeControlSocket = function (socket)
{

    this.showSocketStatistics(socket);

    this.removeCommandLine(socket);

    this.removeSocketFromDefaultQueues(socket);
};

FTPServer.prototype.showSocketStatistics = function (controlSocket)
{
    console.info('Bytes written: '+controlSocket.bytesWritten+ ' read: '+controlSocket.bytesRead);
};
   
FTPServer.prototype.ontimeout = function (controlSocket)
{
    console.info(Date.now(),'Timeout reached. No commands from remote on control connection, disconnecting.');
    this.reply(controlSocket,this.REPLY.SERVICE_NOT_AVAILABLE,'Idle timeout reached, please terminate control connection on remote side.');
    controlSocket.end(); // Server initiated Active close -> User passive close 
    // Server: Send FIN --> connection FIN_WAIT_1 (received ACK for FIN, half-closed) -> FIN_WAIT_2 (waiting for FIN from remote, fully closed) -> TIME_WAIT (waiting for possible packets beloging to connection to get removed from the network (2*Max Segment Lifetime) before allowing new connection on the socket pair again)
    // User : CLOSE_WAIT (server has closed connection)
  
   this.removeControlSocket(controlSocket);
    
    controlSocket.destroy(); // Don't allow any further I/O (in case client sends more data its discarded)
    
};

FTPServer.prototype.onerror = function (socket,error)
{
    console.error(Date.now(),'Error on control connection',error);
};

FTPServer.prototype.onNumberOfConnections = function (error,count)
{
    if (!error)
        console.info('Established connections '+count);
    else
        console.error('error',error);
};

FTPServer.prototype.getSocketRemoteAddress = function (socket)
{
    if (socket.address() === null && socket._peername) // Hack, probing private _ node socket data struct. Could not get remote address after 'end','close' event on socket
        return socket._peername.address+':'+socket._peername.port;
    else
        return socket.remoteAddress+':'+socket.remotePort;
};

FTPServer.prototype.removeCommandLine = function(socket)
{
    this.command[this.getSocketRemoteAddress(socket)] = null; // Leave null trace
};

FTPServer.prototype.newCommandLine = function (socket)
{
    this.command[this.getSocketRemoteAddress(socket)] = {
        line : '',
       command : undefined,
       arguments : undefined
    };
};

FTPServer.prototype.replyWelcome = function (socket)
{
        this.reply(socket,this.REPLY.SERVICE_READY,'Welcome to '+this.configuration.name);

};

FTPServer.prototype.attachDefaultEventListeners = function (socket)
{
      socket.on('data',this.ondata.bind(this,socket));

      socket.on('end', this.onend.bind(this,socket));

      socket.on('error',this.onerror.bind(this,socket));

      socket.on('close',this.onclose.bind(this,socket));
};

FTPServer.prototype.onconnection = function (controlSocket)
{
    var remoteAddr = this.getSocketRemoteAddress(controlSocket);

    this.server.getConnections(this.onNumberOfConnections.bind(this));

    console.log(Date.now(),'Remote '+remoteAddr+' connected to server');

    this.controlSockets.push(controlSocket);

    if (this.configuration.idletimeout)
        console.log('Idle timeout for connection is ',this.configuration.idletimeout+' ms.');
    
    this.newCommandLine(controlSocket);
    
    // RFC p. 50 Connection establishment
    if (this.isServiceEnabled())
    {

        this.attachDefaultEventListeners(controlSocket);

        this.replyWelcome(controlSocket);

    } else {
        this.reply(controlSocket,this.REPLY.PRELIMINARY_SERVICE_DELAY);
        this.attachDefaultEventListeners(controlSocket);

        controlSocket.pause(); // Don't process data events
        this.pendingServiceReadyQueue.push(controlSocket);

    }
    
    if (this.configuration.idletimeout)
      controlSocket.setTimeout(this.configuration.idletimeout,this.ontimeout.bind(this,controlSocket));

};

// Adds watch on buffer size
FTPServer.prototype.write = function (controlSocket,message)
{
    //http://nodejs.org/api/net.html#net_socket_buffersize
    if (controlSocket.bufferSize)
        console.log('Internal node character buffer size',controlSocket.bufferSize);
    controlSocket.write(message);
};

// Convenience function that adds SP and EOL (end-of-line)
FTPServer.prototype.reply = function (controlSocket,reply,additionalDescription)
{
 
    if (reply === undefined)
    {
        console.trace();
         console.error(Date.now(),'Reply is not valid/undefined, cannot write message to controlSocket');
    }

   if (additionalDescription)
      this.write(controlSocket,reply.code+SP+reply.description+SP+additionalDescription+EOL);
    else
      this.write(controlSocket,reply.code+SP+reply.description+EOL);
};

FTPServer.prototype.onlistening = function ()
{
    console.log(arguments);
       
  console.log('Listening',this.server.address());
};

FTPServer.prototype.disableService = function ()
{
    this.serviceUnavailable = true;

    // TO DO : If any data transfers are active, finish it before sending service unavailable
    this.controlSockets.forEach(function (socket)
                                {
                                   this.reply(socket,this.REPLY.SERVICE_NOT_AVAILABLE);
                                },this);

};

// Reply for queued sockets when service is ready
FTPServer.prototype.onReplyWelcome = function (socket)
{

    socket.resume();
    this.replyWelcome(socket);
};

FTPServer.prototype.enableService = function ()
{
    this.serviceUnavailable = false;

    if (this.pendingServiceReadyQueue.length > 0) {
         console.log('Pending queue: Sending welcome to sockets, queue length',this.pendingServiceReadyQueue.length);
        this.pendingServiceReadyQueue.forEach(this.onReplyWelcome,this);
    }

    this.pendingServiceReadyQueue = [];

};

FTPServer.prototype.isServiceEnabled = function ()
{
    return !this.serviceUnavailable;

};

// Based on section 4.2.2 Numeric Order List of Reply Codes, http://www.ietf.org/rfc/rfc959.txt p. 41-43

// http://www.ietf.org/rfc/rfc959.txt p. 49 "a server may substitute text in the replies"

FTPServer.prototype.REPLY = 
 {
    // Second digit : from http://www.ietf.org/rfc/rfc959.txt, p. 38
    
//    x0z   Syntax - These replies refer to syntax errors,
//                  syntactically correct commands that don't fit any
//                  functional category, unimplemented or superfluous
//                  commands.
//
//            x1z   Information -  These are replies to requests for
//                  information, such as status or help.
//
//            x2z   Connections - Replies referring to the control and
//                  data connections.
//
//            x3z   Authentication and accounting - Replies for the login
//                  process and accounting procedures.
//
//            x4z   Unspecified as yet.
//
//            x5z   File system - These replies indicate the status of the
//                  Server file system vis-a-vis the requested transfer or
//                  other file system action.

    // Positive Preliminary reply
    
    //'110' : 'Restart marker reply.',
    PRELIMINARY_SERVICE_DELAY : {
        code : '120',
        description : 'Service not available right now. Try again later.'
    },
    //'120' : 'Service ready in nnn minutes',
    //'125' : 'Data connection already open; transfer starting.',
    //'150' : 'File status okay; about to open data connection.',
    
    // Positive Completion reply
    //'200' : 'Command okay.',
    
    POSITIVE_COMMAND_NOT_IMPLEMENTED : {
        code : '202',
        description : 'Command not implemented, superfluous at this site.'
    },
    //'211' : 'System status, or system help reply.',
    //'212' : 'Directory status.',
    //'213' : 'File status.',
    //'214' : 'Help message.',
    //'215' : 'NAME system type.',
    SERVICE_READY : {
        code : '220',
        description : 'Service ready for new user.'
   },
   // '221' : 'Service closing control connection.',
   // '225' : 'Data connection open; no transfer in progress.',
   // '226' : 'Closing data connection.',
   //'227' : 'Entering passive mode (h1,h2,h3,h4,p1,p2).',
  //'230' : 'User logged in, proceed.',
  //  '250' : 'Requested file action okay, completed.',
 //    '257' : 'PATHNAME created.',
    
    // Positive Intermediate reply
   // '331' : 'Username okay, need password.',
//    '332' : 'Need account for login.',
  //  '350' : 'Requested file action pending further information.',
    
    // Transient Negative Completion reply
    SERVICE_NOT_AVAILABLE : {
        code : '421',
        description : 'Service not available, closing control connection.'
    },
    //'425' : 'Cannot open data connection.',
    //'426' : 'Connection closed; transfer aborted.',
    //'450' : 'Requested file action not taken.',
    //'451' : 'Requested action aborted; local error in processing.',
    //'452' : 'Requested action not taken. Insufficient storage space in system.',
    
    // Permanent Negative Completion reply
    SYNTAX_ERROR_COMMAND_UNRECOGNIZED : {
        code : '500',
        description : 'Syntax error, command unrecognized.'
    },
    //'501' : 'Syntax error in parameters or arguments.',
    NEGATIVE_COMMAND_NOT_IMPLEMENTED : {
        code : '502',
        description : 'Command not implemented.'
    }
    //'503' : 'Bad sequence of commands.',
    //'504' : 'Command not implemented for that parameter.',
    //'530' : 'Not logged in.',
    //'532' : 'Need account for storing files.',
    //'550' : 'Requested action not taken. File unavailable (e.g., file not found, no access).',
    //'551' : 'Requested action aborted: page type unknown.',
    //'552' : 'Requested file action aborted: Exceeded storage allocation (for current directory or dataset).',
    //'553' : 'Requested action not taken. File name not allowed.'
    
};

//  http://www.ietf.org/rfc/rfc959.txt - section 5.3.1 - p. 47
/*
        USER <SP> <username> <CRLF>
        PASS <SP> <password> <CRLF>
        ACCT <SP> <account-information> <CRLF>
        CWD  <SP> <pathname> <CRLF>
        CDUP <CRLF>
        SMNT <SP> <pathname> <CRLF>
        QUIT <CRLF>
        REIN <CRLF>
        PORT <SP> <host-port> <CRLF>
        PASV <CRLF>
        TYPE <SP> <type-code> <CRLF>
        STRU <SP> <structure-code> <CRLF>
        MODE <SP> <mode-code> <CRLF>
        RETR <SP> <pathname> <CRLF>
        STOR <SP> <pathname> <CRLF>
        STOU <CRLF>
        APPE <SP> <pathname> <CRLF>
        ALLO <SP> <decimal-integer>
            [<SP> R <SP> <decimal-integer>] <CRLF>
        REST <SP> <marker> <CRLF>
        RNFR <SP> <pathname> <CRLF>
        RNTO <SP> <pathname> <CRLF>
        ABOR <CRLF>
        DELE <SP> <pathname> <CRLF>
        RMD  <SP> <pathname> <CRLF>
        MKD  <SP> <pathname> <CRLF>
        PWD  <CRLF>
        LIST [<SP> <pathname>] <CRLF>
        NLST [<SP> <pathname>] <CRLF>
        SITE <SP> <string> <CRLF>
        SYST <CRLF>
        STAT [<SP> <pathname>] <CRLF>
        HELP [<SP> <string>] <CRLF>
        NOOP <CRLF>
*/

FTPServer.prototype.COMMAND = {
    USER : 'USER',
    PASS : 'PASS',
    ACCT : 'ACCT',
    CWD : 'CWD',
    CDUP : 'CDUP',
    SMNT : 'SMNT',
    QUIT : 'QUIT',
    REIN : 'REIN',
    PORT : 'PORT',
    PASV : 'PASV',
    TYPE : 'TYPE',
    STRU : 'STRU',
    MODE : 'MODE',
    RETR : 'RETR',
    STOR :'STOR',
    STOU : 'STOU',
    APPE : 'APPE',
    ALLO : 'ALLO',
    REST : 'REST',
    RNFR : 'RNFR',
    RNTO : 'RNTO',
    ABOR : 'ABOR',
    DELE : 'DELE',
    RMD : 'RMD',
    MKD : 'MKD',
    PWD : 'PWD',
    LIST : 'LIST',
    NLST : 'NLST',
    SITE : 'SITE',
    SYST : 'SYST',
    STAT : 'STAT',
    HELP : 'HELP',
    NOOP : 'NOOP'
};


var ftpServer = new FTPServer({name : HOST_NAME,
                            port : COMMAND_PORT_L,
                            host : LOOPBACK_IP,
                            idletimeout : 0,
                            maxConnections : 2
                              });

ftpServer.server.listen(ftpServer.configuration.port,ftpServer.configuration.host, ftpServer.onlistening.bind(ftpServer));

ftpServer.disableService();
console.log("Enabling service in 30 s");
setTimeout(function ()
           {
               console.info("Enabling service NOW");
               this.enableService();

           }.bind(ftpServer),30000);
