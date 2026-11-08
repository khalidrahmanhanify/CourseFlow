const fs = require('fs');
const c = fs.readFileSync('src/main/main.ts','utf8');
const idx = c.indexOf("ipcMain.handle('progress:complete'");
if(idx >= 0) {
  // find end of function
  let brace = c.indexOf('{', idx);
  let depth = 0;
  for(let i=brace; i<c.length; i++) {
    if(c[i] === '{') depth++;
    else if(c[i] === '}') {
      depth--;
      if(depth === 0) {
        console.log(c.substring(idx, i+1));
        break;
      }
    }
  }
}
