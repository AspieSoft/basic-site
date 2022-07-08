// In God We Trust

const {join, resolve} = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const compression = require('compression');
const helmet = require('helmet');
const timeout = require('express-timeout-handler');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const geoIP = require('geoip-lite');
const isBot = require('isbot-fast');
const forceSSL = require('express-force-ssl');

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


let root = (function() {
  if(require.main.filename) {
    return clean(require.main.filename.toString()).replace(/[\\\/][^\\\/]+[\\\/]?$/, '');
  }
  if(require.main.path) {
    clean(require.main.path.toString());
  }
  return join(__dirname).toString().replace(/[\/\\]node_modules[\/\\][^\\\/]+[\\\/]?$/, '');
})();

const GlobalOptions = {
  expressExtended: false,
  bodyParserExtended: false,
};


const regve = (() => {
  try {
    return require('@aspiesoft/regve');
  } catch(e) {}
  try {
    return require('regve');
  } catch(e) {}
  return function() {
    console.warn('\x1b[33mWarning:\x1b[0m optional dependency "regve" is not installed.\nYou can install it with "npm i @aspiesoft/regve"');
  };
})();

const inputmd = (() => {
  try {
    return require('@aspiesoft/inputmd');
  } catch(e) {}
  try {
    return require('inputmd');
  } catch(e) {}
  return function() {
    console.warn('\x1b[33mWarning:\x1b[0m optional dependency "inputmd" is not installed.\nYou can install it with "npm i @aspiesoft/inputmd"');
  };
})();

const turbx = (() => {
  try {
    return require('@aspiesoft/turbx');
  } catch(e) {}
  try {
    return require('turbx');
  } catch(e) {}
  return function() {
    console.warn('\x1b[33mWarning:\x1b[0m optional dependency "turbx" is not installed.\nYou can install it with "npm i turbx"');
  };
})();


let server = undefined;

let viewEngine = undefined;
let viewEngineOpts = undefined;
function setViewEngine(callback, opts) {
  viewEngine = callback;
  if(varType(opts) === 'object') {
    viewEngineOpts = opts;
  }
}

let pages = undefined;
function setPages(handler) {
  if(varType(handler) === 'string') {
    pages = require(handler);
  } else {
    pages = handler;
  }
}

let staticPath = undefined;
function setStaticPath(path = true, path2) {
  if(varType(path) === 'string' && varType(path2) === 'string') {
    staticPath = {};
    staticPath[clean(path)] = clean(path2);
  } else if(path) {
    staticPath = clean(path);
  } else {
    staticPath = join(root, 'public');
  }
}


let pwaOpts = undefined;
function setPWA({name, short_name, start_url, theme_color, background_color, display, orientation, icon, icon_background} = {}, otherOpts = {}){
  pwaOpts = {
    name: name || 'App Name',
    short_name: short_name || 'App',
    start_url: start_url || '/?pwa=true',
    theme_color: theme_color || '#000000',
    background_color: background_color || '#ffffff',
    display: display || 'standalone',
    orientation: orientation || 'any',
    icon: icon || 'favicon.ico',
    icon_background: icon_background,
    ...otherOpts,
  }
}


let expressLimit = '1mb';
function setExpressLimit(limit){
  if(typeof limit === 'number'){
    expressLimit = limit.toString() + 'mb';
  }else{
    expressLimit = limit;
  }
}


let minifyOpts = undefined;
function setMinifyOpts(type){
  if(Array.isArray(type)){
    minifyOpts = type;
  }else if(type){
    minifyOpts = [type];
  }else{
    minifyOpts = ['js', 'css'];
  }
}


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


function start(port = 3000, pageHandler) {

  if((varType(port) === 'string' && Number(port)) || ['function', 'object'].includes(varType(port))) {
    let rPort = pageHandler || 3000;
    pageHandler = port;
    port = rPort;
  }

  if(['function', 'object', 'string'].includes(varType(pageHandler))) {
    setPages(pageHandler);
  }

  const app = express();

  app.set('trust proxy', true);

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  app.use(timeout.handler({
    timeout: 5000,
    onTimeout: function(req, res) {
      res.setHeader('Retry-After', 600);
      res.setHeader('Refresh', 600);
      res.status(503).send('<h1>Error: 503 (Service Unavailable)</h1><h2>Connection timed out. Please try again later.</h2>').end();
    },
  }));

  app.use('/ping', function(req, res) {
    res.status(200).send('pong!').end();
  });

  app.use((req, res, next) => {
    req.startTime = new Date().getTime();
    next();
  });


  // firewall
  const limiter = rateLimit({
    windowMs: 10 * 60000, // 10 minutes
    max: 5000,
    message: 'Too Many Requests!',
  });
  app.use(limiter);

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
  let static = undefined;

  if(staticPath) {
    if(staticPath === true) {
      staticPath = join(root, 'public');
      app.use('/', express.static(staticPath));
      static = '';
    } else if(varType(staticPath) === 'object') {
      key = Object.keys(staticPath)[0];

      if(!staticPath[key].startsWith(root)){
        staticPath = join(root, staticPath[key]);
      }else{
        staticPath = staticPath[key];
      }
      
      app.use(key, express.static(staticPath));

      static = key.replace(/[\\\/]$/, '');
    } else {
      app.use('/', express.static(staticPath));
      static = '';
    }

    if(!fs.existsSync(staticPath)){
      fs.mkdirSync(staticPath);
    }
  }else if(staticPath === undefined){
    staticPath = join(root, 'public');
    app.use('/', express.static(staticPath));
    static = '';

    if(!fs.existsSync(staticPath)){
      fs.mkdirSync(staticPath);
    }
  }


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
                const pwaStaticUrl = static.replace(/[\\\/]+$/);
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
            const pwaStaticUrl = static.replace(/[\\\/]+$/);
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
  if(minifyOpts){
    // minify js
    if(minifyOpts.includes('js') && terser){
      (async function(){
        const opts = {
          ecma: 2020,
          keep_classnames: true,
          parse: {shebang: true},
          // ie8: true,
          compress: {
            ecma: 2020,
            keep_infinity: true,
            passes: 5,
            top_retain: ['window', 'module', 'global', 'return', 'process'],
            typeofs: false,
            // ie8: true,
          },
          mangle: {
            keep_classnames: true,
            reserved: ['window', 'module', 'global', 'return', 'process'],
            // ie8: true,
          },
        };

        fs.readdirSync(staticPath).forEach(file => {
          if(!file.endsWith('.js') || file.endsWith('.min.js')){
            return;
          }
          const filePath = join(staticPath, file);
          fs.readFile(filePath, async (err, data) => {
            if(err){return;}
            const min = await terser.minify(data.toString(), opts);
            if(!min.err && min.code){
              fs.writeFile(filePath.replace(/\.js$/, '.min.js'), min.code, err => {});
            }
          });
        });

        fs.watch(staticPath, async (event, file) => {
          if(!file.endsWith('.js') || file.endsWith('.min.js')){
            return;
          }

          const filePath = join(staticPath, file);

          if(!fs.existsSync(filePath)){
            fs.unlink(filePath.replace(/\.js$/, '.min.js'), err => {});
            return;
          }

          fs.readFile(filePath, async (err, data) => {
            if(err){return;}
            const min = await terser.minify(data.toString(), opts);
            if(!min.err && min.code){
              fs.writeFile(filePath.replace(/\.js$/, '.min.js'), min.code, err => {});
            }else if(!min.err){
              fs.unlink(filePath.replace(/\.js$/, '.min.js'), err => {});
            }
          });
        });
      })();
    }

    // minify css
    if(minifyOpts.includes('css') && csso){
      (async function(){
        fs.readdirSync(staticPath).forEach(file => {
          if(!file.endsWith('.css') || file.endsWith('.min.css')){
            return;
          }
          const filePath = join(staticPath, file);
          fs.readFile(filePath, async (err, data) => {
            if(err){return;}
            const min = csso.minify(data.toString());
            if(!min.err && min.css){
              fs.writeFile(filePath.replace(/\.css$/, '.min.css'), min.css, err => {});
            }
          });
        });

        fs.watch(staticPath, async (event, file) => {
          if(!file.endsWith('.css') || file.endsWith('.min.css')){
            return;
          }

          const filePath = join(staticPath, file);

          if(!fs.existsSync(filePath)){
            fs.unlink(filePath.replace(/\.css$/, '.min.css'), err => {});
            return;
          }

          fs.readFile(filePath, async (err, data) => {
            if(err){return;}
            const min = csso.minify(data.toString());
            if(!min.err && min.css){
              fs.writeFile(filePath.replace(/\.css$/, '.min.css'), min.css, err => {});
            }else if(!min.err){
              fs.unlink(filePath.replace(/\.css$/, '.min.css'), err => {});
            }
          });
        });
      })();
    }
  }


  // view engine
  function buildViewEngineTemplate(views, layout, ext = 'html') {
    if(views && !fs.existsSync(views)) {
      try {
        fs.mkdirSync(views);
      } catch(e) {}
    }
    if(layout) {
      let layoutPath = join(views, layout + '.' + ext);
      if(!fs.existsSync(layoutPath)){
        try {
          fs.copyFileSync(join(__dirname, 'views/layout.html'), layoutPath);
        } catch(e) {}
      }
    }
  }

  if(varType(viewEngine) === 'function') {
    viewEngine(app);
  } else {

    const viewVars = {
      static,
      pwa: usePwa,
      icon: pwaIcon,
      icon_type: pwaIconType,
      min: {
        js: (minifyOpts && minifyOpts.includes('js')) ? 'min.js' : 'js',
        css: (minifyOpts && minifyOpts.includes('css')) ? 'min.css' : 'css',
      }
    };

    if(varType(viewEngine) === 'object') {
      let views = viewEngine.views || viewEngine.dir || join(root, 'views');
      let type = viewEngine.type || 'html';
      app.engine(type, regve({opts: viewVars, ...viewEngine}));
      app.set('views', views);
      app.set('view engine', type);
      buildViewEngineTemplate(views, viewEngine.template || viewEngine.layout || null, type);
    } else if(varType(viewEngine) === 'string') {
      if(viewEngineOpts) {
        let views = viewEngineOpts.views || viewEngineOpts.dir || join(root, 'views');
        let type = viewEngineOpts.type;
        if(!type && viewEngine === 'turbx'){
          type = 'xhtml';
        }else{
          type = 'html';
        }

        if(viewEngine === 'regve') {
          app.engine(type, regve({opts: viewVars, ...viewEngineOpts}));
          app.set('views', views);
          app.set('view engine', type);
        } else if(viewEngine === 'inputmd') {
          app.engine(type, inputmd(views, {opts: viewVars, ...viewEngineOpts}));
          app.set('views', views);
          app.set('view engine', type);
        } else if(viewEngine === 'turbx') {
          app.engine(type, turbx(views, {opts: viewVars, ...viewEngineOpts}));
          app.set('views', views);
          app.set('view engine', type);
        } else {
          app.engine('html', regve({
            template: 'layout',
            dir: viewEngine,
            type: 'html',
            cache: '1D',
            opts: viewVars,
          }));
          app.set('views', viewEngine);
          app.set('view engine', 'html');
        }

        buildViewEngineTemplate(views, viewEngineOpts.template || viewEngineOpts.layout || null, type);
      } else if(viewEngine === 'regve') {
        let views = join(root, 'views');
        app.engine('html', regve({
          template: 'layout',
          dir: views,
          type: 'html',
          cache: '1D',
          opts: viewVars,
        }));
        app.set('views', views);
        app.set('view engine', 'html');
        buildViewEngineTemplate(views, 'layout', 'html');
      } else if(viewEngine === 'inputmd') {
        let views = join(root, 'views');
        app.engine('html', inputmd(views, {
          template: 'layout',
          dir: views,
          type: 'html',
          cache: '1D',
          opts: viewVars,
        }));
        app.set('views', views);
        app.set('view engine', 'html');
        buildViewEngineTemplate(views, 'layout', 'html');
      } else if(viewEngine === 'turbx') {
        let views = join(root, 'views');
        app.engine('xhtml', turbx(views, {
          template: 'layout',
          cache: '1D',
          opts: viewVars,
        }));
        app.set('views', views);
        app.set('view engine', 'xhtml');
        buildViewEngineTemplate(views, 'layout', 'xhtml');
      } else {
        app.engine('html', regve({
          template: 'layout',
          dir: viewEngine,
          type: 'html',
          cache: '1D',
          opts: viewVars,
        }));
        app.set('views', viewEngine);
        app.set('view engine', 'html');
        buildViewEngineTemplate(views, 'layout', 'html');
      }
    } else {
      let views = join(root, 'views');
      app.engine('html', regve({
        template: 'layout',
        dir: views,
        type: 'html',
        cache: '1D',
        opts: viewVars,
      }));
      app.set('views', views);
      app.set('view engine', 'html');
    }
  }


  // middleware
  app.use(express.json({limit: expressLimit}));
  app.use(express.urlencoded({extended: GlobalOptions.expressExtended}));
  app.use(cookieParser());
  app.use(bodyParser.urlencoded({extended: GlobalOptions.bodyParserExtended}));
  app.use(bodyParser.json({type: ['json', 'application/csp-report'], limit: expressLimit}));
  app.use(compression());
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
    req.data = clean(req.data);

    req.static = static;
    req.limit = expressLimit;

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

    res.set('Access-Control-Allow-Methods', 'GET,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Origin,X-Requested-With,content-type,Accept');
    res.setHeader('Access-Control-Allow-Credentials', true);

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

  const usePort = normalizePort(clean(process.env.PORT || port || 3000));
  server = http.createServer(app);

  server.on('error', function(error) {
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
      ? '\x1b[32mpipe ' + addr
      : '\x1b[32mport ' + addr.port;
    console.log('Listening On', bind, '\x1b[0m');
  });

  server.listen(usePort || 3000);

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
  exports.viewEngine = setViewEngine;
  exports.pages = setPages;
  exports.static = setStaticPath;
  exports.pwa = setPWA;
  exports.limit = setExpressLimit;
  exports.minify = setMinifyOpts;

  exports.extended = function(express = true, bodyParser = true){
    GlobalOptions.expressExtended = express;
    GlobalOptions.bodyParserExtended = bodyParser;
  };

  exports.setRoot = function(path){
    root = clean(resolve(path.toString()).toString()).replace(/[\\\/][^\\\/]+[\\\/]?$/, '');
  }

  exports.randToken = generateRandToken;
  exports.clean = clean;
  exports.varType = varType;

  exports.server = server;
  exports.express = express;
  exports.regve = regve;
  exports.helmet = helmet;
  exports.validator = validator;
  exports.geoIP = geoIP;
  exports.isBot = isBot;

  exports.root = root;
  exports.path = safeJoinPath;

  exports.turbx = turbx;

  return exports;
})();
