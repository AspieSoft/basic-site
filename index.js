const {join, resolve} = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const timeout = require('express-timeout-handler');
const validator = require('validator');
const geoIP = require('geoip-lite');
const isBot = require('isbot-fast');
const forceSSL = require('express-force-ssl');
const deviceRateLimit = require('@aspiesoft/express-device-rate-limit');

const turbx = requireOptional('@aspiesoft/turbx');
const pwaAssetGenerator = requireOptional('pwa-asset-generator');
const terser = requireOptional('terser');
const csso = requireOptional('csso');

function requireOptional(mod){
  try {
    return require(mod);
  } catch(e) {
    return undefined;
  }
}

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

let root = (function() {
  if(process.env.PWD){
    return clean(process.env.PWD);
  }

  if(require.main && typeof require.main === 'object'){
    if(require.main.filename) {
      return clean(require.main.filename.toString()).replace(/[\\\/][^\\\/]+[\\\/]?$/, '');
    }
    if(require.main.path) {
      return clean(require.main.path.toString());
    }
  }

  return join(__dirname).toString().replace(/[\/\\]node_modules[\/\\][^\\\/]+[\\\/]?$/, '');
})();

function safeJoinPath(){
  let path = resolve(root);

  let arg0 = resolve(arguments[0]);
  let iStart = 0;
  if(arg0.startsWith(root)){
    path = arg0;
    iStart = 1;
  }

  for(let i = iStart; i < arguments.length; i++){
    let newPath = join(path, arguments[i].replace(/\.\./g, '.').replace(/%/g, ''));
    if(newPath === path || !newPath.startsWith(path)){
      return null;
    }
    path = newPath;
  }

  return path;
}


let pages = undefined;
function setPages(handler) {
  if(varType(handler) === 'string') {
    pages = require(handler);
  } else {
    pages = handler;
  }
}

let rateLimitOpts = {
  // the number of requests that can be made by a user within a given time
  // this is multiplied by the value of the defEffect option
  limit: 100,

  // the amount of time before reseting the recording of a users request rate
  // s: seconds, m: minutes, h: hours, D: days, M: months, Y: years
  time: '1m',

  // the amount of time to kick a user who goes above the rate limit
  kickTime: '1h',

  // the default score to increase a user request rate by
  defEffect: 5,

  // the minimum score to increase a user request rate by
  minEffect: 1,

  // the maximum score to increase a user request rate by
  maxEffect: this.limit * this.defEffect / 20,

  // how strict should a score increase be
  // the amount a score is increased by will be multiplied by this number
  strict: 1,

  // how passive should a score decrease be
  // the amount a score is decreased by will be multiplied by this number
  passive: 1,


  // optional: handle a rate limit error in any way you want
  err: function(req, res, next){
    // by default this status and message is sent if a users request rate goes past the limit
    res.status(429).send('<h1>Error 429</h1><h2>Too Many Requests</h2>').end();
  },


  // optional: geo location options
  // you can increase the effect (rate score) of a user based on location
  geo: {

    // how strict should a score increase be
    // the amount a score is increased by will be multiplied by this number
    //note: if this number is negative, the score will be decreased
    // a decreased score allows you to be stricter on a specific location instead
    strict: 1,

    // the below options are disabled and ignored by default
    //note: each option is added up
    // specifying a country and region will increase the score twice if neither apply

    country: ['US'], // +4

    //note: if the geoIP module returns null, their score will be increased by +2
  },
};

function setRateLimitOptions(opts){
  if(typeof opts === 'object'){
    rateLimitOpts = opts
  }
}

let publicPath = undefined;
let publicUrl = undefined;
function setPublicPath(path, url = '/'){
  if(varType(path) === 'string'){
    publicPath = safeJoinPath(root, path);
  }
  if(varType(url) === 'string'){
    publicUrl = url;
  }
}

let pwaOpts = undefined;
function setPWA(opts){
  if(varType(opts) === 'object'){
    pwaOpts = opts;
  }
}

let viewEnginePath = undefined;
let viewEngineOpts = undefined;
function setViewEngine(path, opts){
  if(typeof path === 'function' || typeof path === 'object'){
    [path, opts] = [opts, path];
  }

  if(varType(path) === 'string'){
    viewEnginePath = safeJoinPath(root, path);
  }

  if(varType(opts) === 'function' || varType(opts) === 'object'){
    viewEngineOpts = opts;
  }
}

let dataSizeLimit = '10mb';
function setDataSizeLimit(limit){
  if(typeof limit === 'number'){
    dataSizeLimit = limit.toString() + 'mb';
  }else{
    dataSizeLimit = limit;
  }
}


function start(port = 3000, pageHandler){
  if(typeof port !== 'number'){
    [port, pageHandler] = [pageHandler, port];
  }
  port = Number(port);

  if(!port || typeof port !== 'number'){
    port = 3000;
  }

  const app = express();
  app.set('trust proxy', true);

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  const readyState = 2;
  let ServerReady = 0;
  let delayedIP = {};
  app.use(async (req, res, next) => {
    if(ServerReady >= readyState){
      next();
      return;
    }

    if(readyState < 0){
      res.setHeader('Retry-After', 600);
      res.setHeader('Refresh', 600);

      res.status(503).send(`<h1>Error: 503 (Service Unavailable)</h1><h2>The server failed to start up. Please wait and try again later.</h2>`).end();
      return;
    }

    let now = Date.now();
    while(ServerReady < readyState && Date.now() - now < 5000){ // 5 seconds
      await sleep(10);
    }

    if(ServerReady < readyState){
      let ip = clean(clean(req.ip).toString()) || '*';
      if(!delayedIP[ip]){
        delayedIP[ip] = 0;
      }
      delayedIP[ip]++;

      let delay = 10;
      if(delayedIP[ip] === 1){
        delay = 5;
      }else if(delayedIP[ip] > 3){
        delay = 600;
      }

      res.setHeader('Retry-After', delay);
      res.setHeader('Refresh', delay);

      if(delay > 30){
        res.status(503).send(`<h1>Error: 503 (Service Unavailable)</h1><h2>The server is still starting up. Please wait and try again later.</h2>`).end();
      }else{
        res.status(503).send(`<h1>Error: 503 (Service Unavailable)</h1><h2>The server is still starting up. Please wait at least ${delay} seconds and try again.</h2>`).end();
      }
      return;
    }

    next();
  });

  // init server listener
  const usePort = normalizePort(clean(process.env.PORT || port || 3000) || 3000);
  server = http.createServer(app);

  server.on('error', function(error) {
    ServerReady = -1;

    if(error.syscall !== 'listen') {
      throw error;
    }
    let bind = varType(usePort) === 'string'
      ? 'Pipe ' + usePort
      : 'Port ' + usePort;
    switch(error.code) {
      case 'EACCES':
        console.error(bind + ' requires elevated privileges');
        process.exit(1);
      case 'EADDRINUSE':
        console.error(bind + ' is already in use');
        process.exit(1);
      default:
        throw error;
    }
  });

  server.on('listening', function() {
    let addr = server.address();
    let bind = varType(addr) === 'string'
      ? '\x1b[33mpipe ' + addr
      : '\x1b[36mport ' + addr.port;
    console.log('\x1b[32mListening On', bind, '\x1b[0m');

    setTimeout(function(){
      ServerReady++;
    }, 100);
  });

  server.listen(usePort || 3000);
  server.setTimeout(5250);

  // setup page handler
  if(['function', 'object', 'string'].includes(varType(pageHandler))) {
    setPages(pageHandler);
  }

  // setup timeout handler
  app.use(timeout.handler({
    timeout: 5000,
    onTimeout: function(req, res) {
      res.setHeader('Retry-After', 600);
      res.setHeader('Refresh', 600);
      res.status(503).send('<h1>Error: 503 (Service Unavailable)</h1><h2>Connection timed out. Please try again later.</h2>').end();
    },
  }));

  // setup
  app.use('/ping', function(req, res) {
    res.status(200).send('pong!').end();
  });

  app.use((req, res, next) => {
    req.startTime = new Date().getTime();
    next();
  });

  const rateLimit = deviceRateLimit(rateLimitOpts);
  rateLimit.all(app);

  app.set('forceSSLOptions', {
    enable301Redirects: true,
    trustXFPHeader: false,
    httpsPort: 443,
    sslRequiredMessage: 'SSL Required!',
  });
  if(process.env.NODE_ENV === 'production') {
    app.use(forceSSL);
  }

  // static path
  const staticPath = publicPath || join(root, 'public');
  const staticUrl = publicUrl || '/';

  if(!fs.existsSync(staticPath)){
    fs.mkdirSync(staticPath);

    let defPublic = join(__dirname, 'defaults/public');
    const files = fs.readdirSync(defPublic);
    if(files){
      for(let i = 0; i < files.length; i++){
        let path = join(defPublic, files[i]);
        fs.copyFileSync(path, join(staticPath, files[i]));
      }
    }
  }

  app.use(staticUrl, express.static(staticPath));

  // pwa
  let usePwa = false;
  let pwaIcon = undefined;
  let pwaIconType = undefined;
  if(pwaOpts){
    usePwa = true;

    let pwaManifest = join(staticPath, 'manifest.json');
    let pwaWorker = join(staticPath, 'service-worker.js');
    let pwaInit = join(staticPath, 'pwa.js');

    let pwaIconPath = undefined;

    if(pwaOpts.icon){
      pwaIcon = pwaOpts.icon;
      pwaIconType = pwaOpts.icon_type || pwaIcon.replace(/^.*\.([\w_-]+)$/, '$1');
      if(pwaIconType === 'ico'){
        pwaIconType = 'x-icon';
      }
      delete pwaOpts.icon_type;

      pwaIconPath = join(staticPath, pwaIcon);

      if(pwaAssetGenerator){
        try {
          fs.watchFile(pwaIconPath, async () => {
            try {
              let {manifestJsonContent} = await pwaAssetGenerator.generateImages(pwaIconPath, join(staticPath, 'icon'), {log: false, background: (pwaOpts.icon_background || pwaOpts.background_color || '#ffffff')});

              if(Array.isArray(manifestJsonContent)){
                const pwaStaticUrl = staticUrl.replace(/[\\\/]+$/);
                manifestJsonContent = manifestJsonContent.map(icon => {
                  return {...icon, src: pwaStaticUrl + icon.src.replace(staticPath, '')};
                });
              }

              pwaOpts.icons = manifestJsonContent;
              fs.writeFileSync(pwaManifest, JSON.stringify(pwaOpts, null, 2));
            } catch(e) {}
          });
        } catch(e) {}
      }
    }

    (async function(){
      if(pwaAssetGenerator && pwaIconPath){
        try {
          let {manifestJsonContent} = await pwaAssetGenerator.generateImages(pwaIconPath, join(staticPath, 'icon'), {log: false, background: (pwaOpts.icon_background || pwaOpts.background_color || '#ffffff')});

          if(Array.isArray(manifestJsonContent)){
            const pwaStaticUrl = staticUrl.replace(/[\\\/]+$/);
            manifestJsonContent = manifestJsonContent.map(icon => {
              return {...icon, src: pwaStaticUrl + icon.src.replace(staticPath, '')};
            });
          }

          pwaOpts.icons = manifestJsonContent;
          delete pwaOpts.icon;
        } catch(e) {}
      }

      fs.writeFileSync(pwaManifest, JSON.stringify(pwaOpts, null, 2));
    })();

    if(!fs.existsSync(pwaWorker)){
      fs.copyFileSync(join(__dirname, 'pwa/service-worker.js'), pwaWorker);
    }

    if(!fs.existsSync(pwaInit)){
      fs.copyFileSync(join(__dirname, 'pwa/pwa.js'), pwaInit);
    }
  }

  // minify
  //todo: watch public dir and auto minify js and css

  // view engine
  let viewPath = viewEnginePath || join(root, 'views');

  if(!fs.existsSync(viewPath)){
    fs.mkdirSync(viewPath);

    let defPublic = join(__dirname, 'defaults/views');
    const files = fs.readdirSync(defPublic);
    if(files){
      for(let i = 0; i < files.length; i++){
        let path = join(defPublic, files[i]);
        fs.copyFileSync(path, join(viewPath, files[i]));
      }
    }
  }

  const viewVars = {
    static: staticUrl,
    pwa: usePwa,
    icon: pwaIcon,
    icon_type: pwaIconType,
    min: {
      js: (terser) ? 'min.js' : 'js',
      css: (csso) ? 'min.css' : 'css',
    }
  };

  if(varType(viewEngineOpts) === 'function'){
    const cb = viewEngineOpts(app, viewVars);
    if(varType(cb) === 'function'){
      app.engine('html', cb);
      app.set('views', viewPath);
      app.set('view engine', 'html');
    }else if(varType(cb) === 'array'){
      let fn, ext, opts;
      for(let i = 0; i < cb.length; i++){
        if(varType(cb[i]) === 'function'){
          fn = cb[i];
        }else if(varType(cb[i]) === 'string'){
          ext = cb[i];
        }else if(varType(cb[i]) === 'object'){
          opts = cb[i];
        }
      }

      if(!fn){
        if(!opts){
          opts = {};
        }

        let template = opts.template || opts.layout || 'layout';
        let cache = opts.cache || '1D';

        fn = turbx({
          template: template,
          opts: viewVars,
          public: staticPath,
          root: root,
          views: viewPath,
          ext: ext,
          cache: cache,
          ...opts,
        }, app);
      }else if(opts){
        let template = opts.template || opts.layout || 'layout';
        let cache = opts.cache || '1D';

        fn = fn({
          template: template,
          opts: viewVars,
          public: staticPath,
          root: root,
          views: viewPath,
          ext: ext,
          cache: cache,
          ...opts,
        });
      }

      app.engine(ext, fn);
      app.set('views', viewPath);
      app.set('view engine', ext);
    }else if(varType(cb) === 'object'){
      let fn = cb.cb || cb.fn;
      let ext = cb.ext || cb.type;
      let opts = cb.opts;

      if(!fn){
        if(!opts){
          opts = {};
        }

        let template = opts.template || opts.layout || 'layout';
        let cache = opts.cache || '1D';

        fn = turbx({
          template: template,
          opts: viewVars,
          public: staticPath,
          root: root,
          views: viewPath,
          ext: ext,
          cache: cache,
          ...opts,
        }, app);
      }else if(opts){
        let template = opts.template || opts.layout || 'layout';
        let cache = opts.cache || '1D';

        fn = fn({
          template: template,
          opts: viewVars,
          public: staticPath,
          root: root,
          views: viewPath,
          ext: ext,
          cache: cache,
          ...opts,
        });
      }

      app.engine(ext, fn);
      app.set('views', viewPath);
      app.set('view engine', ext);
    }
  }else if(varType(viewEngineOpts) === 'object'){
    const engine = turbx || viewEngineOpts.cb || viewEngineOpts.fn;
    if(varType(engine) === 'function'){
      let template = viewEngineOpts.template || viewEngineOpts.layout || 'layout';
      let ext = viewEngineOpts.ext || viewEngineOpts.type || 'html';
      let cache = viewEngineOpts.cache || '1D';

      if(turbx){
        const opts = {...viewEngineOpts}
        delete opts.template;
        delete opts.layout;
        delete opts.ext;
        delete opts.type;
        delete opts.cache;

        app.engine(ext, engine({
          template: template,
          opts: viewVars,
          public: staticPath,
          root: root,
          views: viewPath,
          ext: ext,
          cache: cache,
          ...opts,
        }, app));
      }else{
        app.engine(ext, engine(viewEngineOpts));
      }

      app.set('views', viewPath);
      app.set('view engine', ext);
    }
  }else if(turbx){
    app.engine('html', turbx({
      template: 'layout',
      opts: viewVars,
      public: staticPath,
      root: root,
      views: viewPath,
      ext: 'html',
      cache: '1D',
    }, app));
    app.set('views', viewPath);
    app.set('view engine', 'html');
  }

  // middleware
  app.use(express.json({limit: dataSizeLimit}));
  app.use(express.urlencoded({extended: false}));
  app.use(cookieParser());
  app.use(bodyParser.urlencoded({extended: false}));
  app.use(bodyParser.json({type: ['json', 'application/csp-report'], limit: dataSizeLimit}));
  isBot.extend(['validator']);

  app.use((req, res, next) => {
    req.root = root;
    req.clean = clean;
    req.varType = varType;
    req.validator = validator;
    req.joinPath = safeJoinPath;

    req.query = clean(req.query);
    req.body = clean(req.body);
    req.params = clean(req.params);
    req.data = {};

    req.static = staticUrl;
    req.limit = dataSizeLimit;

    let host = clean(req.hostname || req.headers.host || '');
    if(process.env.NODE_ENV === 'production' && (!host || varType(host) !== 'string' || host === '' || !validator.isFQDN(host))) {
      res.status(400).send('<h1>Error: 400 (Bad Request)</h1><h2>Invalid or Missing Host</h2>').end();
      return;
    }
    if(host) {
      host = host.toString().replace(/[^\w_\-./:]/g, '').replace(/https?:\/\//i, '').split(':', 1).join('');
      if(process.env.NODE_ENV === 'production' && !validator.isFQDN(host)) {
        res.status(400).send('<h1>Error: 400 (Bad Request)</h1><h2>Invalid or Missing Host</h2>').end();
        return;
      }
      req.hostUrl = host;
    } else {
      res.status(400).send('<h1>Error: 400 (Bad Request)</h1><h2>Invalid or Missing Host</h2>').end();
    }

    const browser = clean(req.headers['user-agent'] || '');
    if(!browser || varType(browser) !== 'string' || browser === '') {
      res.status(400).send('<h1>Error: 400 (Bad Request)</h1><h2>Invalid or Missing Browser</h2>').end();
    }
    req.browser = browser;

    let ip = clean(req.ip || req.headers['x-forwarded-for'] || '');
    if(ip && Array.isArray(ip)) {ip = ip[0];}
    if(ip && (ip.startsWith('[') || ip.endsWith(']'))) {
      if(ip.startsWith('[') && ip.endsWith(']')) {
        ip = ip.substr(1, ip.length - 2);
      } else if(ip.startsWith('[')) {
        ip = ip.substr(1, ip.length - 1);
      } else if(ip.endsWith(']')) {
        ip = ip.substr(0, ip.length - 1);
      }
    }
    if(!validator.isIP(ip)) {
      res.status(400).send('<h1>Error: 400 (Bad Request)</h1><h2>Server failed to find your public IP</h2>').end();
      return;
    }
    req.uip = ip;

    if(ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') {
      req.localhost = true;
    } else {
      req.geo = clean(geoIP.lookup(ip));
      req.bot = isBot(browser);
    }

    let url = clean(req.url.toString().replace(/\?.*/, ''));
    if(url !== '/') {
      url = url.replace(/\/$/, '');
    }
    req.url = url;

    res.set('Access-Control-Allow-Methods', 'GET,POST,HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Origin,X-Requested-With,content-type,Accept');
    res.setHeader('Access-Control-Allow-Credentials', true);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Embedder-Policy', 'same-origin');

    //todo: lockup 'X-Frame-Options' header
    //todo: lockup 'X-Powered-By' header (may add an optional function to set this header)

    next();
  });

  app.post('*', (req, res, next) => {
    if(!req.data || varType(req.data) !== 'object') {
      req.data = {};
    }
    if(varType(req.body) === 'object') {
      req.data = Object.assign(clean(req.body), req.data);
    }
    next();
  });

  app.get('*', (req, res, next) => {
    if(!req.data || varType(req.data) !== 'object') {
      req.data = {};
    }
    if(varType(req.query) === 'object') {
      req.data = Object.assign(clean(req.query), req.data);
    }
    next();
  });

  // handle requests
  app.req = function() {
    app.post(...arguments);
    app.get(...arguments);
  };

  if(varType(pages) === 'function') {
    pages(app);
  } else if(varType(pages) === 'object') {
    const pageURLs = Object.keys(pages);
    for(let i = 0; i < pageURLs.length; i++) {
      app.req(pageURLs[i], pages[pageURLs[i]]);
    }
  }

  // handle 404 error
  app.use(function(req, res) {
    res.status(404).send('<h1>Error: 404 (Not Found)</h1><h2>Page Not Found</h2>').end();
  });

  setTimeout(function(){
    ServerReady++;
    console.log('\x1b[32mServer Ready!', '\x1b[0m');

    delayedIP = {};
  }, 100);

  return app;
}


function normalizePort(val) {
  let port = parseInt(val, 10);
  if(isNaN(port)) {return val;}
  if(port >= 0) {return port;}
  return false;
}

function generateRandToken(size = 64) {
  return crypto.randomBytes(size).toString('hex');
}

function clean(input, allowControlChars = false) {
  // valid ascii characters: https://ascii.cl/htmlcodes.htm
  // more info: https://en.wikipedia.org/wiki/ASCII
  let allowList = [
    338,
    339,
    352,
    353,
    376,
    402,

    8211,
    8212,
    8216,
    8217,
    8218,
    8220,
    8221,
    8222,
    8224,
    8225,
    8226,
    8230,
    8240,
    8364,
    8482,
  ];

  function cleanStr(input) {
    input = validator.stripLow(input, {keep_new_lines: true});
    if(validator.isAscii(input)) {
      return input;
    }
    let output = '';
    for(let i = 0; i < input.length; i++) {
      let charCode = input.charCodeAt(i);
      if((allowControlChars && charCode >= 0 && charCode <= 31) || (charCode >= 32 && charCode <= 127) || (charCode >= 160 && charCode <= 255) || allowList.includes(charCode)) {
        output += input.charAt(i);
      }
    }
    if(validator.isAscii(output)) {
      return output;
    }
    return undefined;
  }

  function cleanArr(input) {
    let output = [];
    input.forEach(value => {
      output.push(cleanType(value));
    });
    return output;
  }

  function cleanObj(input) {
    let output = {};
    Object.keys(input).forEach(key => {
      key = cleanType(key);
      output[key] = cleanType(input[key]);
    });
    return output;
  }

  function cleanType(input) {
    if(input === null) {
      return null;
    } else if(input === undefined) {
      return undefined;
    } else if(input === NaN) {
      return NaN;
    }

    let type = varType(input);

    switch(type) {
      case 'string':
        return cleanStr(input);
      case 'array':
        return cleanArr(input);
      case 'object':
        return cleanObj(input);
      case 'number':
        return Number(input);
      case 'boolean':
        return !!input;
      case 'regex':
        let flags = '';
        let re = input.toString().replace(/^\/(.*)\/(\w*)$/, function(str, r, f) {
          flags = cleanStr(f) || '';
          return cleanStr(r) || '';
        });
        if(!re || re === '') {return undefined;}
        return RegExp(re, flags);
      case 'symbol':
        input = cleanStr(input.toString());
        if(input !== undefined) {
          return Symbol(input);
        }
        return undefined;
      case 'bigint':
        return BigInt(input.toString().replace(/[^0-9\.\-\+enf_]/g, ''));
      default:
        return undefined;
    }
  }

  return cleanType(input);
}

function varType(value) {
  if(Array.isArray(value)) {
    return 'array';
  } else if(value === null) {
    return 'null';
  } else if(value instanceof RegExp) {
    return 'regex';
  }
  return typeof value;
}


module.exports = (() => {
  const exports = function(port = 3000, pageHandler) {
    start(port, pageHandler);
  };
  exports.pages = setPages;
  exports.pwa = setPWA;
  exports.engine = setViewEngine;
  exports.dataLimit = setDataSizeLimit;
  exports.public = setPublicPath;
  exports.rateLimit = setRateLimitOptions;

  exports.clean = clean;
  exports.varType = varType;
  exports.randToken = generateRandToken;
  exports.path = safeJoinPath;

  exports.turbx = turbx;

  return exports;
})();
