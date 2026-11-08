const fs = require('fs');
const c = fs.readFileSync('src/renderer/pages/Player.tsx','utf8');
const idx = c.indexOf('persistProgress');
if(idx >= 0) {
  const start = c.lastIndexOf('\n', idx-100);
  const end = c.indexOf('window.api.updateProgress', idx);
  if(end >= 0) {
    const end2 = c.indexOf('});', end);
    if(end2 >= 0) {
      fs.writeFileSync('persist.txt', c.substring(start, end2+3));
      console.log('done');
    }
  }
}
