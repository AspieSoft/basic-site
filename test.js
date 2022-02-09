const {join} = require('path');
const server = require('./index');

server.viewEngine({
  template: 'layout',
  dir: join(__dirname, 'views'),
  type: 'html',
  cache: '1D',
});

server.static('/cdn', join(__dirname, 'public'));


server.pages(function(app) {

  app.use((req, res) => {
    res.render('index');
  });

});

server(3000);


setTimeout(() => {
  process.exit(0);
}, 5000);
