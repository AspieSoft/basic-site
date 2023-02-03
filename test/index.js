const server = require('../index');

server.engine('test/views');
server.public('test/public');

server.pages(app => {
  app.use('/', (req, res) => {
    res.render('index');
  });
});

server(3000);
