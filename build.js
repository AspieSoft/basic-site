const miniforge = require('@aspiesoft/miniforge-js');

miniforge.rootDir(__dirname);

miniforge.build('./index.js', {outputNameMin: true});

console.log('Finished Build');

require('./test');

setTimeout(function(){process.exit(0);}, 5000);
