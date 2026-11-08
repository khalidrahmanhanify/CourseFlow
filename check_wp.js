const fs = require('fs');
const c = fs.readFileSync('src/renderer/pages/Player.tsx','utf8');
const idx = c.indexOf('watchedPercent');
if(idx >= 0) {
  let start = c.lastIndexOf('const watchedPercent', idx);
  if(start == -1) start = idx;
  let end = c.indexOf('\n  };', idx);
  if(end == -1) end = c.indexOf('};', idx);
  console.log(c.substring(start, end+4));
} else {
  console.log('no');
}
