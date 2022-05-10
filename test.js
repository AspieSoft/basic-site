const {join} = require('path');
const server = require('./index');
// const server = require('./index.min');


server.viewEngine({
  template: 'layout',
  dir: join(__dirname, 'views'),
  type: 'html',
  cache: '1D',
});

// server.viewEngine('turbx');

server.static('/', join(__dirname, 'public'));


// server.pwa({icon: 'favicon.png'});
// server.minify();


server.pages(function(app) {

  app.use((req, res) => {
    res.render('index');
  });

});

server(3000);


setTimeout(() => {
  process.exit(0);
}, 5000);
