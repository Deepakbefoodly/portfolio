/* ============================================
   fx.js — shared visual effects for every page
   1. Domain-aware animated background (canvas)
   2. Pointer spotlight on cards
   3. Scroll progress bar + nav state
   4. Mobile nav toggle
   5. Hero role rotator
   ============================================ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------------------------------------------
     1. Animated background
     A graph of drifting nodes — think services in a distributed system,
     layers of an AI pipeline, components in a UI tree. Each node belongs
     to one of the three domains you work in and is labelled with tech
     from that domain; data "packets" hop along the links between them.
     Hovering an element with data-domain="backend|ai|frontend" lights
     that domain up and dims the rest.
  ------------------------------------------------------------------ */
  function initBackground() {
    const canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Node colours are read from the palette in styles.css (--c1 / --c2 / --c3);
    // the values below are only fallbacks (Orchid) if the variables are missing.
    const DOMAINS = {
      backend: {
        rgb: '192,132,252',
        labels: ['Java', 'Spring Boot', 'Kafka', 'Redis', 'PostgreSQL', 'Docker', 'K8s', 'AWS', 'GCP', 'REST'],
      },
      ai: {
        rgb: '244,114,182',
        labels: ['LLM', 'RAG', 'LangGraph', 'LangChain', 'Embeddings', 'Vector DB', 'Python', 'FastAPI', 'Agents'],
      },
      frontend: {
        rgb: '217,70,239',
        labels: ['React', 'TypeScript', 'Vite', 'Redux', 'Zustand', 'Next.js', 'CSS'],
      },
    };
    const KEYS = Object.keys(DOMAINS);

    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      const get = (name, fallback) => cs.getPropertyValue(name).replace(/\s+/g, '') || fallback;
      DOMAINS.backend.rgb = get('--c1', DOMAINS.backend.rgb);
      DOMAINS.ai.rgb = get('--c2', DOMAINS.ai.rgb);
      DOMAINS.frontend.rgb = get('--c3', DOMAINS.frontend.rgb);
    }
    readPalette();
    const boost = { backend: 0, ai: 0, frontend: 0 };
    let focus = null;

    let W = 0, H = 0, dpr = 1, LINK = 140;
    let nodes = [];
    let packets = [];
    let links = [];
    let px = [], py = [];
    const mouse = { x: -1e4, y: -1e4 };
    let scrollY = window.scrollY;
    let last = 0;
    let nextSpawn = 0;
    let rafId = 0;

    const wrap = (v, max) => ((v % max) + max) % max;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function seed() {
      const count = clamp(Math.round((W * H) / 20000), 24, 72);
      LINK = W < 700 ? 112 : 165;
      nodes = [];
      const used = { backend: 0, ai: 0, frontend: 0 };
      for (let i = 0; i < count; i++) {
        // Weighted so all three domains are always present
        const dom = KEYS[i % 3];
        const labels = DOMAINS[dom].labels;
        const labelled = Math.random() < 0.5;
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 16,
          vy: (Math.random() - 0.5) * 16,
          r: 1.4 + Math.random() * 1.7,
          z: 0.4 + Math.random() * 0.6,
          dom,
          label: labelled ? labels[used[dom]++ % labels.length] : null,
          ox: 0,
          oy: 0,
        });
      }
      packets = [];
    }

    function resize() {
      // a hidden/collapsed viewport reports 0 — keep the previous size instead of dividing by it
      if (!window.innerWidth || !window.innerHeight) return;
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduceMotion) frame(performance.now(), true);
    }

    // multiplier for a domain's brightness given the current focus
    function mult(dom) {
      const fmax = Math.max(boost.backend, boost.ai, boost.frontend);
      return 1 + boost[dom] * 1.4 - (1 - boost[dom]) * fmax * 0.45;
    }

    function frame(now, once) {
      // schedule the next frame first, so a single bad frame can never stop the animation
      if (!once && !document.hidden) rafId = requestAnimationFrame(frame);
      if (!W || !H) return;

      const dt = Math.max(0, Math.min((now - last) / 1000 || 0.016, 0.05));
      last = now;

      // ease focus boosts
      for (const k of KEYS) {
        const target = focus === k ? 1 : 0;
        boost[k] += (target - boost[k]) * Math.min(1, dt * 6);
      }

      ctx.clearRect(0, 0, W, H);

      // --- positions (with scroll parallax + pointer attraction) ---
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!once) {
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          if (n.x < -30) n.x = W + 30; else if (n.x > W + 30) n.x = -30;
          if (n.y < -30) n.y = H + 30; else if (n.y > H + 30) n.y = -30;
        }
        let x = n.x;
        let y = wrap(n.y - scrollY * 0.1 * n.z, H);

        const mdx = mouse.x - x;
        const mdy = mouse.y - y;
        const md = Math.hypot(mdx, mdy);
        let tx = 0, ty = 0;
        if (md < 190 && md > 1) {
          const s = (1 - md / 190) * 30;
          tx = (mdx / md) * s;
          ty = (mdy / md) * s;
        }
        n.ox += (tx - n.ox) * 0.08;
        n.oy += (ty - n.oy) * 0.08;
        px[i] = x + n.ox;
        py[i] = y + n.oy;
      }

      // --- links ---
      links.length = 0;
      ctx.lineWidth = 1;
      const L2 = LINK * LINK;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = px[i] - px[j];
          const dy = py[i] - py[j];
          const d2 = dx * dx + dy * dy;
          if (d2 > L2) continue;
          const d = Math.sqrt(d2);
          const a = nodes[i];
          const b = nodes[j];
          const m = Math.max(mult(a.dom), mult(b.dom));
          const alpha = Math.min(0.75, (1 - d / LINK) * 0.4 * m);
          links.push({ i, j, d });
          ctx.strokeStyle = `rgba(${DOMAINS[a.dom].rgb},${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(px[i], py[i]);
          ctx.lineTo(px[j], py[j]);
          ctx.stroke();
        }
      }

      // --- pointer links ---
      if (mouse.x > -1000) {
        for (let i = 0; i < nodes.length; i++) {
          const d = Math.hypot(px[i] - mouse.x, py[i] - mouse.y);
          if (d < 170) {
            ctx.strokeStyle = `rgba(${DOMAINS[nodes[i].dom].rgb},${((1 - d / 170) * 0.4).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(mouse.x, mouse.y);
            ctx.lineTo(px[i], py[i]);
            ctx.stroke();
          }
        }
      }

      // --- packets (data hopping across the graph) ---
      if (!once) {
        if (now > nextSpawn && packets.length < 12 && links.length) {
          const l = links[(Math.random() * links.length) | 0];
          const forward = Math.random() < 0.5;
          packets.push({ a: forward ? l.i : l.j, b: forward ? l.j : l.i, t: 0, speed: 90 + Math.random() * 90 });
          nextSpawn = now + 350 + Math.random() * 500;
        }
        for (let k = packets.length - 1; k >= 0; k--) {
          const p = packets[k];
          const dx = px[p.b] - px[p.a];
          const dy = py[p.b] - py[p.a];
          const dist = Math.hypot(dx, dy);
          if (dist > LINK * 1.2 || dist < 1) { packets.splice(k, 1); continue; }
          p.t += (p.speed * dt) / dist;
          if (p.t >= 1) {
            // hop to a random neighbour of the node we just reached
            const next = [];
            for (const l of links) {
              if (l.i === p.b && l.j !== p.a) next.push(l.j);
              else if (l.j === p.b && l.i !== p.a) next.push(l.i);
            }
            if (next.length && Math.random() < 0.8) {
              p.a = p.b;
              p.b = next[(Math.random() * next.length) | 0];
              p.t = 0;
            } else {
              packets.splice(k, 1);
            }
            continue;
          }
          const x = px[p.a] + dx * p.t;
          const y = py[p.a] + dy * p.t;
          const rgb = DOMAINS[nodes[p.a].dom].rgb;
          const m = mult(nodes[p.a].dom);
          // tail
          const tx = x - (dx / dist) * 14;
          const ty = y - (dy / dist) * 14;
          const g = ctx.createLinearGradient(tx, ty, x, y);
          g.addColorStop(0, `rgba(${rgb},0)`);
          g.addColorStop(1, `rgba(${rgb},${Math.min(0.9, 0.7 * m).toFixed(2)})`);
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.lineWidth = 1;
          // head + halo
          ctx.fillStyle = `rgba(${rgb},${(0.14 * m).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.fill();
          ctx.fillStyle = `rgba(${rgb},0.95)`;
          ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.2832); ctx.fill();
        }
      }

      // --- nodes + labels ---
      ctx.font = '11px "DM Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const rgb = DOMAINS[n.dom].rgb;
        const m = mult(n.dom);
        const b = boost[n.dom];
        const r = n.r * (1 + b * 0.6);
        ctx.fillStyle = `rgba(${rgb},${Math.min(0.26, 0.1 * m).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px[i], py[i], r * 3.6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(${rgb},${clamp(0.75 * m, 0.25, 1).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, 6.2832); ctx.fill();
        if (n.label) {
          ctx.fillStyle = `rgba(${rgb},${clamp(0.58 * m, 0.18, 0.95).toFixed(3)})`;
          ctx.fillText(n.label, px[i] + r + 7, py[i] + 0.5);
        }
      }
    }

    function start() {
      if (reduceMotion || rafId) return;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // --- events ---
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // ignore small height changes (mobile URL bar showing/hiding)
        if (Math.abs(window.innerWidth - W) > 40 || Math.abs(window.innerHeight - H) > 160) resize();
      }, 150);
    });

    window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });

    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || !e.target.closest) return;
      const el = e.target.closest('[data-domain]');
      const dom = el && el.dataset.domain;
      focus = DOMAINS[dom] ? dom : null;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });

    resize();
    start();
    if (reduceMotion) frame(performance.now(), true);
  }

  /* ------------------------------------------------------------------
     2. Spotlight — sets --mx / --my on the hovered card so its CSS
        radial-gradient follows the pointer.
  ------------------------------------------------------------------ */
  function initSpotlight() {
    if (!finePointer) return;
    const SEL = '.skill-category, .project-card, .blog-card, .hero-card, .timeline-item, .value-item, .contact-link, .contact-info-panel';
    let raf = 0;
    let ev = null;
    document.addEventListener('pointermove', (e) => {
      ev = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ev.target.closest && ev.target.closest(SEL);
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        el.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
     3 + 4. Scroll progress, nav "scrolled" state, mobile menu toggle
  ------------------------------------------------------------------ */
  function initChrome() {
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    document.body.appendChild(bar);

    const nav = document.querySelector('nav');
    let ticking = false;

    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();

    if (!nav) return;
    const links = nav.querySelector('.nav-links');
    if (!links) return;

    const btn = document.createElement('button');
    btn.className = 'nav-hamburger';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(btn);

    const setOpen = (open) => {
      nav.classList.toggle('menu-open', open);
      links.classList.toggle('open', open);
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => setOpen(!links.classList.contains('open')));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  }

  /* ------------------------------------------------------------------
     5. Hero role rotator — types through what you build
  ------------------------------------------------------------------ */
  function initRoleRotator() {
    const el = document.getElementById('role-rotator');
    if (!el || reduceMotion) return;
    const words = [
      'scalable backends',
      'AI-powered products',
      'LLM & RAG pipelines',
      'React experiences',
      'distributed systems',
    ];
    let w = 0;
    let c = words[0].length;
    let deleting = true; // first word is already on screen
    const step = () => {
      const word = words[w];
      if (deleting) {
        c--;
        el.textContent = word.slice(0, c);
        if (c === 0) {
          deleting = false;
          w = (w + 1) % words.length;
          return setTimeout(step, 320);
        }
        return setTimeout(step, 28);
      }
      c++;
      el.textContent = words[w].slice(0, c);
      if (c === words[w].length) {
        deleting = true;
        return setTimeout(step, 1700);
      }
      return setTimeout(step, 55);
    };
    setTimeout(step, 2200);
  }

  initBackground();
  initSpotlight();
  initChrome();
  initRoleRotator();
})();
