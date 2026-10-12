// "On Linux?" — the page puts on green, from wherever it was pressed.
//
// The same page, the same layout: only the colours change, to terminal green
// with faint scan lines (linux.css, under `html.linux`). The change spreads
// from the press as a blob rather than a circle, its edge the sum of a few sine
// waves whose phases drift as it grows, so the edge boils; characters fly along
// that edge. Pressed again, it shrinks back to the press.
//
// It is a View Transition: the browser takes a picture of the page as it is and
// as it will be, and the blob is a clip on the new picture (or on the old one,
// going back). The whole shape over time is worked out once, before it starts,
// as keyframes the browser plays itself; drawing on a picture costs a frame
// next to nothing, where clipping the live page meant painting all of it again
// every frame, which is what made it stutter. Browsers without View
// Transitions, and visitors who would rather not have motion, just change.
(function () {
  var trigger = document.querySelector('[data-linux-open]');
  if (!trigger) return;

  var TEXT = {
    en: {
      ask: 'On Linux?',
      noticed: 'Looks like you’re on Linux',
      back: 'Back to Windows',
    },
    tr: {
      ask: 'Linux mu kullanıyorsunuz?',
      noticed: 'Linux’ta olduğunu fark ettik',
      back: 'Windows’a dön',
    },
  };
  var text = document.documentElement.lang === 'tr' ? TEXT.tr : TEXT.en;

  // The shape: how many points round the edge, and the waves that bend it —
  // each a multiple of once round, and how far it pushes the edge in and out.
  var POINTS = 72;
  var WAVES = [
    [3, 0.2],
    [7, 0.12],
    [13, 0.07],
  ];
  // Far enough that even where the edge dips furthest in it is past the
  // farthest corner: 1 − 0.2 − 0.12 − 0.07 is 0.61, and 1.8 × 0.61 is over one.
  var REACH = 1.8;
  var DURATION = 1100;
  // Keyframes for the whole run, one every 1/60 s; the browser goes straight
  // from one to the next, which at this spacing nobody can tell from a curve.
  var STEPS = 66;
  var GLYPHS = '01#$%&*+=/\\|<>{}[]~^:;?!@';
  var FLYING = 110;
  var GLYPH_SIZE = 14;
  var GREEN = '#3fb950';
  // The browser bar on a phone, which the page's own colour does not reach.
  var THEME = { windows: '#16110d', linux: '#0a120d' };

  var root = document.documentElement;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var busy = false;
  var atlas = null;

  // Said differently to somebody who is already on Linux.
  function onLinux() {
    var data = window.navigator.userAgentData;
    if (data && data.platform) return /linux/i.test(data.platform);
    var agent = window.navigator.userAgent || '';
    return /Linux/.test(agent) && !/Android/.test(agent);
  }
  var ask = onLinux() ? text.noticed : text.ask;

  function label() {
    var green = root.classList.contains('linux');
    trigger.textContent = green ? text.back : ask;
    if (themeColor) themeColor.content = green ? THEME.linux : THEME.windows;
  }
  label();
  trigger.hidden = false;

  function middleOf(target) {
    var box = target.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  }

  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** A fresh set of waves: their phases, and how far each drifts while it runs. */
  function waves() {
    return WAVES.map(function (wave) {
      return {
        k: wave[0],
        size: wave[1],
        phase: Math.random() * Math.PI * 2,
        drift: (Math.random() - 0.5) * 6,
      };
    });
  }

  /** How far out the edge is at `angle`, `t` of the way through, for a radius of `r`. */
  function edge(angle, t, r, bend) {
    var out = 1;
    for (var i = 0; i < bend.length; i++) {
      var wave = bend[i];
      out += wave.size * Math.sin(wave.k * angle + wave.phase + wave.drift * t);
    }
    return r * out;
  }

  /** The farthest corner of the window from a point. */
  function farthest(x, y) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    return Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
  }

  /** The blob's radius `t` of the way through: growing from nothing, or shrinking to it. */
  function radius(t, full, growing) {
    var eased = ease(t);
    return full * (growing ? eased : 1 - eased);
  }

  /** The whole run as clip-path keyframes, worked out before it starts. */
  function keyframes(x, y, full, growing, bend) {
    var frames = [];
    for (var s = 0; s <= STEPS; s++) {
      var t = s / STEPS;
      var r = radius(t, full, growing);
      var points = [];
      for (var i = 0; i < POINTS; i++) {
        var angle = (i / POINTS) * Math.PI * 2;
        var reach = Math.max(0, edge(angle, t, r, bend));
        points.push(
          (x + Math.cos(angle) * reach).toFixed(1) + 'px ' + (y + Math.sin(angle) * reach).toFixed(1) + 'px',
        );
      }
      frames.push({ clipPath: 'polygon(' + points.join(',') + ')' });
    }
    return frames;
  }

  /**
   * Every character, drawn once in green on a strip, so a frame copies little
   * pictures instead of setting type 110 times.
   */
  function glyphAtlas(scale) {
    var cell = Math.ceil(GLYPH_SIZE * 1.3 * scale);
    var strip = document.createElement('canvas');
    strip.width = cell * GLYPHS.length;
    strip.height = cell;
    var context = strip.getContext('2d');
    context.font = GLYPH_SIZE * scale + 'px ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = GREEN;
    for (var i = 0; i < GLYPHS.length; i++) context.fillText(GLYPHS[i], i * cell + cell / 2, cell / 2);
    return { strip: strip, cell: cell, scale: scale };
  }

  /**
   * The canvas the characters fly on, over the whole window. It has a
   * transition name of its own (linux.css), so the browser keeps it out of the
   * page's picture — where the blob would clip it — and shows it live on top.
   */
  function flyingCanvas() {
    var scale = Math.min(2, window.devicePixelRatio || 1);
    if (!atlas || atlas.scale !== scale) atlas = glyphAtlas(scale);
    var canvas = document.createElement('canvas');
    canvas.className = 'linux-ascii';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    document.body.append(canvas);
    return canvas;
  }

  /**
   * Draw the characters `t` of the way through: new ones every frame, just
   * inside the edge and some way past it, fainter the further from it, and gone
   * over the last stretch.
   */
  function fly(canvas, x, y, t, r, bend) {
    var context = canvas.getContext('2d');
    var scale = atlas.scale;
    var cell = atlas.cell;
    var w = window.innerWidth;
    var h = window.innerHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    var fade = t > 0.85 ? (1 - t) / 0.15 : 1;
    if (fade <= 0 || r <= 1) return;
    for (var c = 0; c < FLYING; c++) {
      var at = Math.random() * Math.PI * 2;
      var off = -12 + Math.random() * 40;
      var from = edge(at, t, r, bend) + off;
      var cx = x + Math.cos(at) * from;
      var cy = y + Math.sin(at) * from;
      if (cx < -20 || cy < -20 || cx > w + 20 || cy > h + 20) continue;
      context.globalAlpha = Math.max(0.08, 1 - Math.abs(off) / 28) * fade;
      var glyph = Math.floor(Math.random() * GLYPHS.length);
      context.drawImage(
        atlas.strip,
        glyph * cell,
        0,
        cell,
        cell,
        Math.round(cx * scale - cell / 2),
        Math.round(cy * scale - cell / 2),
        cell,
        cell,
      );
    }
    context.globalAlpha = 1;
  }

  function change() {
    root.classList.toggle('linux');
    label();
  }

  /** Put the green on, or take it off, spreading from (x, y). */
  function toggle(x, y) {
    if (busy) return;
    if (reduced || !document.startViewTransition) {
      change();
      return;
    }
    busy = true;
    var growing = !root.classList.contains('linux');
    var bend = waves();
    var full = farthest(x, y) * REACH;
    var canvas = flyingCanvas();
    // Which picture the blob clips, and so which goes on top; see linux.css.
    root.setAttribute('data-linux-going', growing ? 'in' : 'out');

    var transition = document.startViewTransition(change);
    var running = null;
    transition.ready
      .then(function () {
        running = root.animate(keyframes(x, y, full, growing, bend), {
          duration: DURATION,
          easing: 'linear',
          fill: 'forwards',
          pseudoElement: growing ? '::view-transition-new(root)' : '::view-transition-old(root)',
        });
        // The characters follow the browser's own clock for the blob, so they
        // stay on its edge even when a frame comes late.
        function frame() {
          if (!running) return;
          var t = Math.min(1, (Number(running.currentTime) || 0) / DURATION);
          fly(canvas, x, y, t, radius(t, full, growing), bend);
          if (t < 1) window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);
        return running.finished;
      })
      .catch(function () {
        // Skipped (the tab went to the background, say): the page has changed
        // all the same, just without the blob.
      })
      .then(function () {
        // Over by itself once the blob has run; this only makes sure of it.
        transition.skipTransition();
        return transition.finished;
      })
      .catch(function () {})
      .then(function () {
        // Held at its last frame until now, so the pictures never showed
        // unclipped between the blob ending and the transition.
        if (running) running.cancel();
        running = null;
        canvas.remove();
        root.removeAttribute('data-linux-going');
        busy = false;
      });
  }

  trigger.addEventListener('click', function (event) {
    // From the pointer, or from the middle of the button when it was the keyboard.
    var from = event.detail ? [event.clientX, event.clientY] : middleOf(trigger);
    toggle(from[0], from[1]);
  });
})();
