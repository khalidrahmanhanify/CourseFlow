with open('src/renderer/pages/Player.tsx','r',encoding='utf-8') as f:
    c = f.read()

# Try to find watchedPercent
idx = c.find('watchedPercent')
if idx >= 0:
    # look backwards for function start
    start = c.rfind('const watchedPercent', 0, idx)
    if start == -1:
        start = idx
    # look forwards for the function end
    # find next occurrence of "};" at same level
    # simple approach
    end = c.find('\n  };', start)
    if end == -1:
        end = c.find('};', start)
        if end >= 0:
            end = end + 2
    else:
        end = end + 4
    if start >= 0 and end > start:
        old = c[start:end]
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
        print('bad')
else:
    print('no')
