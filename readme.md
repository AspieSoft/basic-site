# Basic Site

![npm](https://img.shields.io/npm/v/basic-site)
![Libraries.io dependency status for latest release](https://img.shields.io/librariesio/release/npm/basic-site)
![GitHub top language](https://img.shields.io/github/languages/top/aspiesoft/basic-site)
![NPM](https://img.shields.io/npm/l/basic-site)

![npm](https://img.shields.io/npm/dw/basic-site)
![npm](https://img.shields.io/npm/dm/basic-site)

[![paypal](https://img.shields.io/badge/buy%20me%20a%20coffee-paypal-blue)](https://buymeacoffee.aspiesoft.com/)

A simple module that runs express with a common setup for a basic website.

Develop your express sites faster.

Useful if you tend to make a lot of apis or web apps that run on express.

Behind the sense, this module adds in middleware for basic security and compression.

- Also sets "trust proxy" to true for reverse proxies like nginx.
- Includes the ability to add any view engine you choose.
- Includes the optional default view engine (@aspiesoft/regve) pre setup if installed as a dependency.
- Runs the helmet module.
- Adds easy access to validator, and a function to sanitize variable types.
- Combines req.body and req.query into a single req.data (post data has priority over get data).
- In production (process.env.NODE_ENV === 'production'), forces ssl and verifies if the hostname is a FQDN with validator.
- Checks if the request is from localhost.
- Gets the geo IP country code with the geoip-country module.
- Runs a simple check to detect bots using the isbot-fast module (could be useful for SEO development).
- Simplifies the req.url to remove extra / at end, and removes query vars from the url (still accessible with req.query).
- Only allows GET and POST methods with "Access-Control-Allow-Methods".
- Limits the request size to 1mb.
- Adds a /ping url that runs before the view engine (simply returns "pong!") (useful for quickly checking if the server is online).
- You still have full access to the express module.

## Installation

```shell script
npm install @aspiesoft/basic-site

# or without optional dependencies
npm install @aspiesoft/basic-site --no-optional
```

## Setup

You can use any view engine you want. By default, this module runs on [regve](https://github.com/aspiesoft/regve) made by AspieSoft. It has a similar syntax to handlebars, but with more features and better stability. It also supports a markdown like syntax.

```js
const server = require('@aspiesoft/basic-site');


// basic setup
server.pages({
  '/url': function(req, res, next){
    // express page callback here
    res.render('index', {opts});
  },
  '/url2': function(req, res, next){
    // express page callback here
    res.render('url2', {opts});
  },
});

// start server
const port = 3000;
server(port);

// default: add .html views to "views" directory
// default: add static files to "public" directory


// advanced setup

const {join} = require('path');

// set static path (optional) (default: public)
server.static('/', join(__dirname, 'public'));

// set view engine (optional) (default: regve with below options)
server.viewEngine('regve' || 'inputmd', {
  template: 'layout',
  dir: join(__dirname, 'views'),
  type: 'html',
  cache: '1D',
});
// regve and inputmd are view engines made by AspieSoft

// regve is similar to handlebars, but with more features and less crashing

// inputmd simply adds a markdown like syntax to html
// it allows basic inputs similar to handlebars, and allows importing files (but has no functions or if statements)

// set any other view engine (optional)
server.viewEngine(function(app){
  // setup view engine
  app.engine('html', regve({
    template: 'layout',
    dir: join(__dirname, 'views'),
    type: 'html',
    cache: '1D',
  }));
});


// set pages
server.pages(function(app){
  app.use('/url', (req, res, next) => {
    // express page callback here
  });

  // app.req will add the pages as app.post and app.get combination
  app.req('/url2', (req, res, next) => {
    // express page callback here
  });

  app.post('/url3', (req, res, next) => {
    // express page callback here
  });

  app.get('/url3', (req, res, next) => {
    // express page callback here
  });
});

// or pass an object to pages (used app.req method)
server.pages({
  '/url': function(req, res, next){
    // express page callback here
  },
  '/url2': function(req, res, next){
    // express page callback here
  },
});


// start server
const port = 3000;
server(port);

```

## Usage

```js

function(req, res, next){
  req.startTime // the time the request started (time is set after some basics like the helmet module have run)
  req.static // the static url if set (example: "/cdn") or undefined
  req.root // the root file this module detected as the main file you used to start the server
  req.clean(jsVar) // sanitizes any variable type and ensures valid utf8 (also checks nested objects and arrays)
  req.varType(jsVar) // returns the typeof variable and also returns if the var is an array, null, or regex
  req.validator // returns the validator module
  req.hostUrl // returns the host url without the http:// or https://
  req.browser // returns the user-agent
  req.uip // returns the ip after cleaning it up and fixing ipv6
  req.localhost // returns true if the request is from localhost (127.0.0.1, localhost, ::1)
  req.geo // returns the result from the ip lookup from the geoip-country module
  req.bot // returns the result from the isbot-fast module after passing the browser (user-agent)
  req.url // created by express, and modified by this module to remove query vars and the trailing / at the end of the string

  req.body // the POST data sent by the user
  req.query // the GET data sent by the user
  req.data // the combined POST and GET data sent by the user (with POST taking priority over GET)
}

// other useful functions
server.randToken(size /* 64 */) // returns crypto.randomBytes(size).toString('hex')
server.clean // same as req.clean
server.varType // same as req.varType
server.root // same as req.root

server.server // returns the server object produced after starting the module
server.express // returns the express module
server.helmet // returns the helmet module
server.validator // returns the validator module
server.geoIP // returns the geoip-country module
server.isBot // returns the isbot-fast module

```
