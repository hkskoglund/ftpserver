/* global require: true */

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
    this.commandStr = '';
    
    this.configuration = configuration;
    
    if (this.configuration === undefined)
    {
        this.configuration = {};
        this.configuration.name = HOST_NAME;
        this.configuration.port = COMMAND_PORT_L;
        this.configuration.idletimeout = 0;
        console.info('Created default configuration',this.configuration);
    }
    
    this.server.listen(this.configuration.port,this.configuration.host, this.onlistening.bind(this));
}

FTPServer.prototype.ondata = function (controlSocket,data)
{
      var cmd, 
          dataStr = data.toString(),
          commandSplit,
          paramNr,
          param = [],
          currentParam,
          indexEOL,
          currentCommand;
    

      indexEOL = dataStr.indexOf(EOL);

      if (indexEOL === -1) // Not received EOL just append received data to command string
      {
          this.commandStr += dataStr;
          return; /* "It should be noted that the server is to take no action until the end of line code is received." RFC 959 p. 46 */
      }

      this.commandStr += dataStr.substring(0,indexEOL);

      commandSplit = this.commandStr.split(SP);

    console.log("commandstr",this.commandStr);

      /*cmd = dataSplit[0];

      for (paramNr=1;paramNr<dataSplit.length;paramNr++)
      {
          currentParam = dataSplit[paramNr];
          if (paramNr == dataSplit.length-1)
          {
              // Strip of EOL on last parameter
              if (EOL === currentParam.substr(-2))
                 currentParam = currentParam.substr(0,currentParam.length-EOL.length);

          }

          param.push(currentParam);
      }*/

      this.reply(controlSocket,this.REPLY.POSITIVE_COMMAND_NOT_IMPLEMENTED); // Positive command not implemented is more relaxed
};

FTPServer.prototype.onend = function (controlSocket,data)
{
       console.log('Remote disconnected control connection');
       this.showStatistics(controlSocket);
};

FTPServer.prototype.showStatistics = function (controlSocket)
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
  
    this.showStatistics(controlSocket);
    
    controlSocket.destroy(); // Don't allow any further I/O (in case client sends more data its discarded)
    
};

FTPServer.prototype.onerror = function (error)
{
    console.error(Date.now(),'Error on control connection',error);
};

FTPServer.prototype.onconnection = function (controlSocket)
{
   
    console.log(Date.now(),'Remote established control connection from ',controlSocket.remoteAddress+':'+controlSocket.remotePort);
    if (this.configuration.idletimeout)
        console.log('Idle timeout is ',this.configuration.idletimeout+' ms.');
    
    controlSocket.on('data',this.ondata.bind(this,controlSocket));
                        
    controlSocket.on('end', this.onend.bind(this,controlSocket));
    
    controlSocket.on('error',this.onerror.bind(this,controlSocket));
    
    this.reply(controlSocket,this.REPLY.SERVICE_READY,'Welcome to '+this.configuration.name);
    
    if (this.configuration.idletimeout)
      controlSocket.setTimeout(this.configuration.idletimeout,this.ontimeout.bind(this,controlSocket));

};

FTPServer.prototype.write = function (controlSocket,message)
{
    //http://nodejs.org/api/net.html#net_socket_buffersize
    if (controlSocket.bufferSize)
        console.log('Internal node character buffer size',controlSocket.bufferSize);
    controlSocket.write(message);
};

// Convenience function that adds SP and EOL (end-of-line)
FTPServer.prototype.reply = function (controlSocket,code,message)
{
 
    if (code === undefined)
    {
        console.trace();
         console.error(Date.now(),'Reply code is not valid/undefined, cannot write message to controlSocket',message);
    }

   if (message)
      this.write(controlSocket,code+SP+this.REPLY[code]+SP+message+EOL);
    else
      this.write(controlSocket,code+SP+this.REPLY[code]+EOL);
};

FTPServer.prototype.onlistening = function ()
{
    console.log(arguments);
       
  console.log('Listening',this.server.address());
};

// Based on section 4.2.2 Numeric Order List of Reply Codes, RFC 959 p. 41-43

FTPServer.prototype.REPLY = 
 {
    // Second digit : from RFC 959, p. 38 
    
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
    
    '110' : 'Restart marker reply',
    '120' : 'Service ready in nnn minutes',
    '125' : 'Data connection already open; transfer starting.',
    '150' : 'File status okay; about to open data connection.',
    
    // Positive Completion reply
    '200' : 'Command okay.',
    
    POSITIVE_COMMAND_NOT_IMPLEMENTED : '202',
    '202' : 'Command not implemented, superfluous at this site.',
    '211' : 'System status, or system help reply',
    '212' : 'Directory status',
    '213' : 'File status',
    '214' : 'Help message.',
    '215' : 'NAME system type.',
    SERVICE_READY : '220',
    '220' : 'Service ready for new user.',
    '221' : 'Service closing control connection.',
    '225' : 'Data connection open; no transfer in progress.',
    '226' : 'Closing data connection',
    '227' : 'Entering passive mode (h1,h2,h3,h4,p1,p2).',
    '230' : 'User logged in, proceed.',
    '250' : 'Requested file action okay, completed',
    '257' : 'PATHNAME created',
    
    // Positive Intermediate reply
    '331' : 'Username okay, need password.',
    '332' : 'Need account for login.',
    '350' : 'Requested file action pending further information.',
    
    // Transient Negative Completion reply
    SERVICE_NOT_AVAILABLE : '421',
    '421' : 'Service not available, closing control connection.',
    '425' : 'Cannot open data connection.',
    '426' : 'Connection closed; transfer aborted.',
    '450' : 'Requested file action not taken',
    '451' : 'Requested action aborted; local error in processing.',
    '452' : 'Requested action not taken. Insufficient storage space in system.',
    
    // Permanent Negative Completion reply
    '500' : 'Syntax error, command unrecognized',
    '501' : 'Syntax error in parameters or arguments.',
    NEGATIVE_COMMAND_NOT_IMPLEMENTED : '502',
    '502' : 'Command not implemented.',
    '503' : 'Bad sequence of commands',
    '504' : 'Command not implemented for that parameter',
    '530' : 'Not logged in',
    '532' : 'Need account for storing files',
    '550' : 'Requested action not taken. File unavailable (e.g., file not found, no access',
    '551' : 'Requested action aborted: page type unknown.',
    '552' : 'Requested file action aborted: Exceeded storage allocation (for current directory or dataset)',
    '553' : 'Requested action not taken. File name not allowed'
    
};

// RFC 959 - section 5.3.1 - p. 47
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

FTPServer.prototype.COMMANDS = [
    'USER',
    'PASS',
    'ACCT',
    'CWD',
    'CDUP',
    'SMNT',
    'QUIT',
    'REIN',
    'PORT',
    'PASV',
    'TYPE',
    'STRU',
    'MODE',
    'RETR',
    'STOR',
    'STOU',
    'APPE',
    'ALLO',
    'REST',
    'RNFR',
    'RNTO',
    'ABOR',
    'DELE',
    'RMD',
    'MKD',
    'PWD',
    'LIST',
    'NLST',
    'SITE',
    'SYST',
    'STAT',
    'HELP',
    'NOOP'
];


var ftpServer = new FTPServer({name : HOST_NAME,
                            port : COMMAND_PORT_L,
                            host : LOOPBACK_IP,
                            idletimeout : 0});
