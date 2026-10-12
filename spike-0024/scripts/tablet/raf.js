(() => {
  if (window.__oylRafStats) return 'already';
  const stats = { since: performance.now(), frames: 0, over20: 0, over34: 0, over50: 0, over100: 0, max: 0, last: undefined };
  window.__oylRafStats = stats;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((now) => {
      // WebGPURenderer keeps a requestAnimationFrame loop of its own, so two callbacks share
      // one frame's time: only the first of a frame is a frame.
      if (now === stats.last) return callback(now);
      if (stats.last !== undefined) {
        const gap = now - stats.last;
        stats.frames += 1;
        if (gap > 20) stats.over20 += 1;
        if (gap > 34) stats.over34 += 1;
        if (gap > 50) stats.over50 += 1;
        if (gap > 100) stats.over100 += 1;
        if (gap > stats.max) stats.max = gap;
      }
      stats.last = now;
      callback(now);
    });
  return 'installed';
})()
