const fs = require('fs');
const c = fs.readFileSync('src/main/main.ts','utf8');
const idx = c.indexOf("ipcMain.handle('progress:complete'");
if(idx >= 0) {
  console.log(c.substring(idx, idx+1000));
} else {
  console.log('not found');
}
