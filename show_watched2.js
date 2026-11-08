const fs = require('fs');
const c = fs.readFileSync('src/renderer/pages/Player.tsx','utf8');
const idx = c.indexOf('const watchedPercent');
if(idx >= 0) {
  const end = c.indexOf('  };', idx);
  if(end == -1) {
    const end2 = c.indexOf('\n  };', idx);
    console.log(c.substring(idx, end2+4));
  } else {
    console.log(c.substring(idx, end+3));
  }
}
