/* global console:true, require: true, setTimeout: true*/

'use strict';

var net = require('net');

/*

Sec. 3.2 ESTABLISHING DATA CONNECTIONS, p 18, http://www.ietf.org/rfc/rfc959.txt

"The user-process default data port is the same as the control connection port (i.e., U).  The server-process default data port is the port adjacent to the control connection port (i.e., L-1)."

"Every FTP implementation must support the use of the default data ports, and only the USER-PI can initiate a change to non-default ports. It is possible for the user to specify an alternate data port by use of the PORT command."

Testing with wireshark:

    GNOME Nautilus: ftp.uninett.no

        request server to enter passive "listening" mode:
        130	192.168.0.102:54840	128.39.3.170:ftp	FTP	Request: PASV
        131	128.39.3.170:ftp	192.168.0.102:54840	FTP	Response: 227 Entering Passive Mode (128,39,3,170,94,200)
        then immediatly connect to the data socket offered by the server (SYN SYNACK ACK handshake)
        135	192.168.0.102	54840	128.39.3.170	ftp	FTP	Request: LIST -a
        136	128.39.3.170	ftp	   192.168.0.102	54840	FTP	Response: 150 Accepted data connection
        137	128.39.3.170	24264	192.168.0.102	36487	FTP-DATA	FTP Data: 1448 bytes
        FTP Data (drwxr-xr-x   22 0          0                4096 Dec 20  2013 .\r\ndrwxr-xr-x   22 0          0                4096 Dec 20  2013 ..\r\ndrwxrwxr-x   10 11113      300              4096 Jun 20 11:01 FreeBSD\r\ndrwxr-xr-x   16 498

    Firefox:
        also uses PASV command

        http://www.ncftp.com/ncftpd/doc/misc/ftp_and_firewalls.html

            Due to NAT/Firewall use PASV command instead of PORT (user connect to server)
*/

var CONFIG = {
    CONTROL_PORT_L : {
        ALTERNATIVE : 8124,
        DEFAULT : 21 },
    DATA_PORT : {
        DEFAULT : 20
    },
    LOOPBACK_IP : '127.0.0.1',
    HOST_NAME : 'FAKE FTP_SERVER'
};

var CRLF = '\r\n', EOL = CRLF;
var SP = ' ';
var USER_PREFIX = 'U:';
var SERVER_PREFIX = 'S:';

function FTPServer (configuration)
{
    // Server for control connections
    this.controlServer = net.createServer(this.onControlConnection.bind(this));

    this.controlServer.on('close',this.onControlServerClose.bind(this));

    this.controlServer.on('error',this.onControlServerError.bind(this));

    this.serviceUnavailable = false;

    this.pendingServiceReadyQueue = []; // Queue of users pending for service ready message

    this.controlUsers = [];
    
    this.configuration = configuration;
    
    if (this.configuration === undefined)
    {
        this.configuration = {};
        this.configuration.name = CONFIG.HOST_NAME;
        this.configuration.idletimeout = 0;
        console.info('Created default configuration',this.configuration);
    }

    if (!configuration.port)
        configuration.port = CONFIG.CONTROL_PORT_L.DEFAULT;

    this.controlServer.maxConnections = this.configuration.maxConnections || 1;
    console.log("Max connections",this.controlServer.maxConnections);

}



FTPServer.prototype.listen = function ()
{
    this.controlServer.listen(this.configuration.port,this.configuration.host, this.onControlListening.bind(this));
   };



FTPServer.prototype.onControlServerError = function (error)
{
    console.error('Control Server error',error);
};

// Get all matching commands, by comparing with all FTP commands
FTPServer.prototype.findMatchingCommand = function(command)
{

    var cmdFilter = function (cmd)
    {
        return (cmd.indexOf(this) === 0);
    };

    if (!command)
    {
        console.error('Undefined or null command, cannot find matching command');
        return ;
    } else
        return Object.getOwnPropertyNames(FTPServer.prototype.COMMAND).filter(cmdFilter,command.toUpperCase());

};

FTPServer.prototype.onControlServerClose = function ()
{
    console.log(this.configuration.name+' closed/not listening for new user control connections.');
};

FTPServer.prototype.close = function ()
{
    var userSocket;

    this.controlServer.close();

    // End users

    for (var userNr=0; userNr < this.uses.length; userNr++)
    {
        userSocket = this.controlUsers[userNr].controlSocket;
        this.reply(userSocket,this.REPLY.SERVICE_NOT_AVAILABLE,'Please close connection of your end.');
        userSocket.end();
        userSocket.destroy();
    }

};

FTPServer.prototype.getUser = function (controlSocket)
{
    return this.controlUsers.filter(function (socket) { return (socket == controlSocket); })[0];
};


FTPServer.prototype._checkUsername = function (username)
{
    return true; // Allow any user
};

FTPServer.prototype._okLogin = function (user,msg)
{
    if (!user.loggedIn) {
        this.reply(user.controlSocket,this.REPLY.NOT_LOGGED_IN,msg);
          return false;
    }
    else
       return true;
};

// Protocol Intepreter - parses a particular FTP command extracted from the command line
FTPServer.prototype.protocolIntepreter = function (user)
{

  console.log('Intepret:',user.command);

    switch (user.command.command)
    {

      // Access control

       case FTPServer.prototype.COMMAND.USER :


            user.username = user.command.arguments[0];
            if (!user.username)
                user.username = 'anonymous'; // Allow only USER without an argument

            this.reply(user.controlSocket,this.REPLY.USER_LOGGED_IN);
            user.loggedIn = true;

            break;

        case FTPServer.prototype.COMMAND.PASS :

            if (!this._okLogin(user,'User not logged in, specify USER first'))
                break;

            user.password = user.command.arguments[0];

            this.reply(user.controlSocket,this.REPLY.USER_LOGGED_IN);

            break;

        case FTPServer.prototype.COMMAND.PASV:

            if (!this._okLogin(user,'User not logged in, refusing passive mode (listening) for data connection'))
                break;

            user.listen();


            break;

        case FTPServer.prototype.COMMAND.LIST:

              if (!this._okLogin(user,'User not logged in, cannot list directory contents'))
                break;

              if (!user.isConnected()) {
                  this.reply(user.controlSocket,this.REPLY.NO_DATA_CONNECTION,'Cannot list directory without a data connection, try PASV first');
                  break;
              }

              break;


        case FTPServer.prototype.COMMAND.RETR:

            user.retrieve.pathname = user.command.arguments[0];

            if (!user.loggedIn)
                this._replyNotLoggedIn(user,'Cannot retrieve '+user.retrieve.pathname);

            if (!user.retrieve.pathname)
                this.reply(user.controlSocket,this.REPLY.SYNTAX_ERROR_IN_ARGUMENETS,'No pathname to file given as argument');

            // TO DO : Check existence of file
            break;

       default :
             this.reply(user.controlSocket,this.REPLY.POSITIVE_COMMAND_NOT_IMPLEMENTED);
            break;
    }

};

FTPServer.prototype.processCommandLine = function (user,dataStr)
{
     var
          commandSplit,
          indexEOL,
          matchingCommands,

         nextCommandLine;

     indexEOL = dataStr.indexOf(EOL);

      if (indexEOL === -1) // Not received EOL just append received data to command string
      {
          user.command.line += dataStr;
          return; /* "It should be noted that the server is to take no action until the end of line code is received." http://www.ietf.org/rfc/rfc959.txt p. 46 */
      }

      user.command.line += dataStr.substring(0,indexEOL);

      commandSplit = user.command.line.split(SP).filter(function (element) { return (element !== ''); });

    console.log("command.line",user.command.line,commandSplit);

    matchingCommands = this.findMatchingCommand(commandSplit[0]);
    console.log('matcing commands',matchingCommands);

     if (!matchingCommands || matchingCommands.length === 0 )
         this.reply(user.controlSocket,this.REPLY.SYNTAX_ERROR_COMMAND_UNRECOGNIZED);
    else if (matchingCommands.length > 1)
        this.reply(user.controlSocket,this.REPLY.SYNTAX_ERROR_COMMAND_UNRECOGNIZED,'Ambigous commands '+matchingCommands);
    else {
        user.command.command = matchingCommands[0];
        user.command.arguments = commandSplit.slice(1);

        this.protocolIntepreter(user);
    }

   user.command.line = ''; // Reset for next command line

    nextCommandLine = dataStr.substring(indexEOL+2); // Next command line or "" empty string;
    if (nextCommandLine.length)
      this.processCommandLine(user,nextCommandLine);
};

FTPServer.prototype.onControlData = function (user,data)
{
    var strData = data;

    if (typeof data !== 'string')
    {
        console.warn('Expected a type of string for data on control connection is now',typeof data,'will attempt to use .toString on it');
        strData = data.toString();
        console.warn('Conversion from',data,'to '+strData,'length',strData.length);
    }

    console.log(USER_PREFIX+SP+user.ip,strData);

     this.processCommandLine(user,strData);

};

FTPServer.prototype.removeUserFromQueue = function (queue,user)
{
    var indx = queue.indexOf(user);
    if (indx !== -1)
        queue.splice(indx,1);
    //else
    //    console.warn('Cannot remove socket from queue',queue,socket);
};

FTPServer.prototype.removeUserFromDefaultQueues = function(user)
{
    this.removeUserFromQueue(this.controlUsers,user);
    this.removeUserFromQueue(this.pendingServiceReadyQueue,user);
};

FTPServer.prototype.onControlClose = function (user,had_error)
{
   if (had_error)
       console.error(Date.now(),'Socket had transmission error(s) and is fully closed now',user.ip);
};

FTPServer.prototype.onControlEnd = function (user,data)
{

    console.log('User '+user.ip+' disconnected control connection');

    user.showControlSocketStatistics();

    this.removeUserFromDefaultQueues(user);
};

   
FTPServer.prototype.ontimeout = function (userControlSocket)
{
    console.info(Date.now(),'Timeout reached. No commands from remote on control connection, disconnecting.');
    this.reply(userControlSocket,this.REPLY.SERVICE_NOT_AVAILABLE,'Idle timeout reached, please terminate control connection on remote side.');
    userControlSocket.end(); // Server initiated Active close -> User passive close
    // Server: Send FIN --> connection FIN_WAIT_1 (received ACK for FIN, half-closed) -> FIN_WAIT_2 (waiting for FIN from remote, fully closed) -> TIME_WAIT (waiting for possible packets beloging to connection to get removed from the network (2*Max Segment Lifetime) before allowing new connection on the socket pair again)
    // User : CLOSE_WAIT (server has closed connection)
  
   this.removeControlSocket(userControlSocket);
    
    userControlSocket.destroy(); // Don't allow any further I/O (in case user sends more data its discarded)
    
};

FTPServer.prototype.onControlError = function (socket,error)
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


FTPServer.prototype.replyWelcome = function (socket)
{
        this.reply(socket,this.REPLY.SERVICE_READY,'Welcome to '+this.configuration.name);

};

FTPServer.prototype.attachDefaultControlEventListeners = function (user)
{
      user.controlSocket.on('data',this.onControlData.bind(this,user));

      user.controlSocket.on('end', this.onControlEnd.bind(this,user));

      user.controlSocket.on('error',this.onControlError.bind(this,user));

      user.controlSocket.on('close',this.onControlClose.bind(this,user));
};

// Handler for 'conncetion'-event, called when user connect for exchanging data on a new socket
FTPServer.prototype.onDataConnection = function (userDataSocket)
{
    console.log("User connected to data server");
};

// Handler for 'connection'-event, called for every user that access server on the listening host:port
FTPServer.prototype.onControlConnection = function (userControlSocket)
{
    var user;

     user = new User(userControlSocket,this.configuration,this);
    this.controlUsers.push(user);

    userControlSocket.setEncoding('utf-8'); // UTF-8 backwards compatible with ASCII, http://nodejs.org/api/stream.html#stream_readable_setencoding_encoding

    this.controlServer.getConnections(this.onNumberOfConnections.bind(this));

    console.log('User '+user.ip+' connected to server');

    if (this.configuration.idletimeout)
        console.log('Idle timeout for connection is ',this.configuration.idletimeout+' ms.');

    // RFC p. 50 Connection establishment
    if (this.isServiceEnabled())
    {

        this.attachDefaultControlEventListeners(user);

        this.replyWelcome(userControlSocket);

    } else {

        this.reply(userControlSocket,this.REPLY.PRELIMINARY_SERVICE_DELAY);

        this.attachDefaultControlEventListeners(user);

        userControlSocket.pause(); // Don't process data events

        this.pendingServiceReadyQueue.push(user);

    }
    
    if (this.configuration.idletimeout)
      userControlSocket.setTimeout(this.configuration.idletimeout,this.ontimeout.bind(this,userControlSocket));

};

FTPServer.prototype._getFormattedIpAddr = function (addr)
{
    return addr.address+':'+addr.port;
};

// Adds watch on buffer size
FTPServer.prototype.write = function (userControlSocket,message)
{
    //http://nodejs.org/api/net.html#net_socket_buffersize
    if (userControlSocket.bufferSize)
        console.log('Internal node character buffer size',userControlSocket.bufferSize);
    console.log(SERVER_PREFIX,message);
    userControlSocket.write(message);
};

// Convenience function that adds SP and EOL (end-of-line)
FTPServer.prototype.reply = function (userControlSocket,reply,additionalDescription)
{
 
    if (reply === undefined)
    {
        console.trace();
         console.error(Date.now(),'Reply is not valid/undefined, cannot write message to userControlSocket');
    }

   if (additionalDescription)
      this.write(userControlSocket,reply.code+SP+reply.description+SP+additionalDescription+EOL);
    else
      this.write(userControlSocket,reply.code+SP+reply.description+EOL);
};

// Return ip adr. of data server in (h1,h2,h3,h4,p1,p2) format required for PASV command response
FTPServer.prototype._getCommaFormattedAddress = function (addr)
{
    return (addr.address+','+(addr.port >> 8)+','+(addr.port & 0xFF)).split('.').join(',');
};

// Handler for 'listening' event for control server
FTPServer.prototype.onControlListening = function ()
{
  this.controlServerAddress = this.controlServer.address();
  console.log('Listening for CONTROL connections on '+this._getFormattedIpAddr(this.controlServerAddress));
};

FTPServer.prototype.disableService = function ()
{
    this.serviceUnavailable = true;

    // TO DO : If any data transfers are active, finish it before sending service unavailable
    this.controlUsers.forEach(function (user)
                                {
                                   this.reply(user.controlSocket,this.REPLY.SERVICE_NOT_AVAILABLE);
                                },this);

};

// Reply for queued sockets when service is ready
FTPServer.prototype.onReplyWelcome = function (user)
{
   var socket = user.controlSocket;
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

    DATA_CONNECTION_OPEN : {
        code : '225',
        description : 'Data connection open; no transfer in progress.'
    },
   // '226' : 'Closing data connection.',

    ENTERING_PASSIVE_MODE :
    {
        code : '227',
        description : 'Entering passive mode, i.e listening for user data connection.'
    },

    USER_LOGGED_IN : {
        code : '230',
        description : 'User logged in, proceed.'
    },
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

    NO_DATA_CONNECTION : {
        code : '425',
        description : 'Data connection not open.',
        rfc_description : 'Cannot open data connection.'
    },
    //'426' : 'Connection closed; transfer aborted.',

   /* REQUESTED_ACTION_NOT_TAKEN : {
        code : '450',
        description : 'Requested file action not taken.'
    },*/
    //'451' : 'Requested action aborted; local error in processing.',
    //'452' : 'Requested action not taken. Insufficient storage space in system.',
    
    // Permanent Negative Completion reply
    SYNTAX_ERROR_COMMAND_UNRECOGNIZED : {
        code : '500',
        description : 'Syntax error, command unrecognized.'
    },
    SYNTAX_ERROR_IN_ARGUMENETS : {
        code : '501',
        description : 'Syntax error in parameters or arguments.'
    },
    NEGATIVE_COMMAND_NOT_IMPLEMENTED : {
        code : '502',
        description : 'Command not implemented.'
    },
    BAD_COMMAND_SEQUENCE : {
        code : '503',
        description : 'Bad sequence of commands.'
    },

    //'504' : 'Command not implemented for that parameter.',
    NOT_LOGGED_IN : {
      code : '530',
      description : 'Not logged in.'
    }

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

function User(controlSocket,configuration,ftpServer)
{
   // console.log("User control socket",controlSocket);
    this.ftpServer = ftpServer; // Allows access to methods
    this.controlSocket = controlSocket;
    this.dataSockets = [];
    this.ip = this.getSocketRemoteAddress(controlSocket);
    this.command = {
       line : '',
       command : undefined,
       arguments : undefined
    };

    this.name = undefined;
    this.password = undefined;

    this.loggedIn = false;

    this.retrieve = {
        pathname : undefined
    };

    this.store = {
        pathname : undefined
    };


    //this.history = []; // Session history of commands

    this.configuration = configuration;

    this.mode = this.MODE.ACTIVE;
}

// Create data server process (aka DTP) for passive mode - called when user request 'PASV' on control connection
User.prototype.listen = function ()
{
    // TO DO : a guard only allowing one data server (don't accept multiple PASV commands)
    this.dataServer = net.createServer(this.onDataConnection.bind(this));

    this.dataServer.on('close',this.onDataServerClose.bind(this));

    this.dataServer.on('error',this.onDataServerError.bind(this));

     this.dataServer.maxConnections =  1;
    console.log('Data server max connections',this.dataServer.maxConnections);

     this.dataServer.listen(0,this.configuration.host,this.onDataListening.bind(this)); // Choose random port
    // Linux : cat /proc/sys/net/ipv4/ip_local_port_range 32768 - 61000 port range for ephemeral ports
    // http://en.wikipedia.org/wiki/Ephemeral_port
    // http://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback


    this.mode = this.MODE.PASSIVE;

};

User.prototype.isConnected = function ()
{
    return (this.dataSockets.length > 0);
};

User.prototype.onDataListening = function ()
{
    var controlServer = this.ftpServer;
    this.dataServerAddress = this.dataServer.address();
    console.log('Listening for DATA connections on ',this.ftpServer._getFormattedIpAddr(this.dataServerAddress));

    controlServer.reply(this.controlSocket,controlServer.REPLY.ENTERING_PASSIVE_MODE,' ('+controlServer._getCommaFormattedAddress(this.dataServerAddress)+')');

};

// For upload
User.prototype.onData = function (dataSocket,data)
{
    console.log('Data conncetion: received',this.getSocketRemoteAddress(dataSocket),data);
};

// http://nodejs.org/api/net.html#net_event_end, emitted when the other end of the sockets emits FIN
User.prototype.onDataEnd = function (dataSocket)
{
    console.log('Data connection: end',this.getSocketRemoteAddress(dataSocket));
};

User.prototype.onDataError = function (dataSocket,error)
{
    console.error('Data connection: error',this.getSocketRemoteAddress(dataSocket),error);
};

User.prototype.onDataClose = function (dataSocket,had_error)
{
    if (had_error)
        console.log('Data connection: socket closed due to transmission error',this.getSocketRemoteAddress(dataSocket));
    else
      console.log('Data connection: close',this.getSocketRemoteAddress(dataSocket));
};

User.prototype.attachDefaultDataEventListeners = function (dataSocket)
{
      dataSocket.on('data',this.onData.bind(this,dataSocket));

      dataSocket.on('end', this.onDataEnd.bind(this,dataSocket));

      dataSocket.on('error',this.onDataError.bind(this,dataSocket));

      dataSocket.on('close',this.onDataClose.bind(this,dataSocket));
};

// 'Connection'-event for data server
User.prototype.onDataConnection = function (dataSocket)
{
    this.dataIp = this.getSocketRemoteAddress(dataSocket);
    console.log('New data connection from '+this.dataIp);
    this.dataSockets.push(dataSocket);
    this.attachDefaultDataEventListeners(dataSocket);

};

User.prototype.onDataServerClose = function ()
{
    console.log('Data server closed for user ');
   /* for (var dataSocketNr = 0; dataSocketNr < this.dataSockets.length; dataSocketNr++)
    {
        this.dataSockets[dataSocketNr].close();
        this.dataSockets[dataSocketNr].destroy();
    }
        */
};

User.prototype.onDataServerError = function (error)
{
    console.error('Data server error for user',error);
};


User.prototype.getSocketRemoteAddress = function (socket)
{

    if (socket.address() === null && socket._peername) // Hack, probing private _ node socket data struct. Could not get remote address after 'end','close' event on socket
        return socket._peername.address+':'+socket._peername.port;
    else
        return socket.remoteAddress+':'+socket.remotePort;

};


User.prototype.showControlSocketStatistics = function ()
{
    console.info('Control connection:  w: '+this.controlSocket.bytesWritten+ ' r: '+this.controlSocket.bytesRead);
};

User.prototype.MODE = {
    ACTIVE : 'active',
    PASSIVE : 'passive'
};


var ftpServer = new FTPServer({name : CONFIG.HOST_NAME,
                            port : CONFIG.CONTROL_PORT_L.ALTERNATIVE,
                            host : CONFIG.LOOPBACK_IP,
                            idletimeout : 0,
                            maxConnections : 2
                              });

ftpServer.listen();

function Test(server)
{
    this.controlServer = server;
}

Test.prototype.disableThenEnableService = function (delay)
{
    var ftpServer = this.controlServer;
    // Test : disabling service
    ftpServer.disableService();
    console.log("Enabling service in ",delay);
    setTimeout(function ()
               {
                   console.info("Enabling service NOW");
                   this.enableService();

               }.bind(ftpServer),delay);

};

Test.prototype.closeServer = function (delay)
{
      var ftpServer = this.controlServer;
    console.log('Closing server in ',delay);
    setTimeout(function ()
               {
                   console.info('Closing server');
                   this.close();

               }.bind(ftpServer),delay);

};

var test = new Test(ftpServer);

//test.disableThenEnableService(30000);
//test.closeServer(40000);

