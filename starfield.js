// starfield.js — lightweight animated starfield background
export function initStarfield() {
  // Check if canvas already exists
  let canvas = document.getElementById('space');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'space';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let w = 0, h = 0;
  let stars = [];
  let t = 0;
  let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cfg = {
    count: window.matchMedia('(max-width: 768px)').matches ? 120 : 240,
    maxParallax: 18,
    minR: 0.5,
    maxR: 1.8
  };

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  const pointer = { x: 0.5, y: 0.5 };
  const offset = { x: 0, y: 0 };

  function resize() {
    w = canvas.width = Math.floor(window.innerWidth * DPR);
    h = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    initStars();
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < cfg.count; i++) {
      const depth = rand(0.3, 1.0);
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rand(cfg.minR, cfg.maxR) * depth * DPR,
        d: depth,
        spd: rand(0.001, 0.004),
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function drawBackground() {
    const g = ctx.createRadialGradient(w * 0.7, h * 0.2, Math.min(w, h) * 0.05, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(10,16,32,0.9)');
    g.addColorStop(1, 'rgba(3,7,17,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function draw() {
    if (!reduceMotion) { t += 1; }
    const targetX = (pointer.x - 0.5) * cfg.maxParallax * DPR;
    const targetY = (pointer.y - 0.5) * cfg.maxParallax * DPR;
    offset.x = lerp(offset.x, targetX, 0.06);
    offset.y = lerp(offset.y, targetY, 0.06);

    drawBackground();
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const tw = reduceMotion ? 1 : (0.7 + 0.3 * Math.sin(t * s.spd + s.phase));
      ctx.globalAlpha = 0.8 * tw;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 220, 255, 0.9)';
      ctx.fill();
      if (!reduceMotion) {
        s.x += 0.02 * s.d;
        if (s.x > w + 10) s.x = -10;
      }
    }
    ctx.restore();
    if (!reduceMotion) {
      requestAnimationFrame(draw);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - rect.left) / rect.width;
    pointer.y = (e.clientY - rect.top) / rect.height;
  }, { passive: true });

  resize();
  if (reduceMotion) {
    drawBackground();
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
      ctx.fill();
    }
  } else {
    requestAnimationFrame(draw);
  }
}
