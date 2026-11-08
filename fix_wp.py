with open('src/renderer/pages/Player.tsx','r',encoding='utf-8') as f:
    c = f.read()

start = c.find('const watchedPercent')
if start >= 0:
    line_start = c.rfind('\n', 0, start)
    idx_semi = c.find('};', start)
    if idx_semi >= 0:
        old = c[line_start:idx_semi+2]
        new = '''  const watchedPercent = (video: HTMLVideoElement) => {
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    if (total <= 0) return 0;
    if (completedRef.current) return 100;
    const pos = Math.max(0, video.currentTime || 0);
    return Math.min(100, Math.max(0, (pos / total) * 100));
  };'''
        c2 = c.replace(old, new)
        with open('src/renderer/pages/Player.tsx','w',encoding='utf-8') as f:
            f.write(c2)
        print('ok')
    else:
        print('no2')
else:
    print('no0')
