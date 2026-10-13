// "On Linux?" — the page puts on green, from wherever it was pressed.
//
// The same page, the same layout: only the colours change, to terminal green
// with faint scan lines (linux.css, under `html.linux`). The change spreads
// from the press as a blob, its edge a smooth curve bent by a few slow sine
// waves. Light runs along that edge, with rings of it rippling out ahead, and
// characters ride just past it; where it has passed, it leaves characters
// behind that wait until the page has fully changed and then go. Pressed
// again, it shrinks back to the press, and then nothing shows outside the
// green that is left.
//
// It is a View Transition: the browser takes a picture of the page as it is and
// as it will be, and the blob is a clip on the new picture (or on the old one,
// going back). The whole shape over time is worked out before it starts, as
// keyframes the browser plays itself, so the page is never painted again while
// it runs. The light and the characters are drawn on a canvas of their own
// above both pictures, following the browser's clock for the blob. Browsers
// without View Transitions, and visitors who would rather not have motion,
// just change.
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
  var POINTS = 140;
  var WAVES = [
    [3, 0.14],
    [5, 0.07],
    [9, 0.035],
  ];
  // How far each wave's phase may drift over the whole run, either way.
  var DRIFT = 1.5;
  // Far enough that even where the edge dips furthest in it is past the
  // farthest corner: 1 − 0.14 − 0.07 − 0.035 is 0.755, and 1.4 × 0.755 is over one.
  var REACH = 1.4;
  var DURATION = 1200;
  // Keyframes for the whole run, one every 1/60 s.
  var STEPS = 72;

  // The light along the edge: how wide, how bright, and the layers it is
  // stroked in, each a share of that width and how strong.
  var GLOW = 45;
  var BRIGHT = 0.9;
  var HALO = [
    [2, 0.035],
    [1.4, 0.05],
    [1, 0.07],
    [0.66, 0.09],
    [0.4, 0.13],
    [0.22, 0.2],
  ];
  // Rings rippling out ahead of the edge: how many, how many times each
  // crosses its stretch in a run, and how far that is, in widths of the light.
  var RINGS = 3;
  var RING_PACE = 2.4;
  var RING_REACH = 4;

  var GLYPHS = '01#$%&*+=/\\|<>{}[]~^:;?!@';
  var GLYPH_CELL = 28;
  var GLYPH_FONT = 13;
  // Characters left where the edge has passed, so many to a square pixel, and
  // how long they take to go once the page has changed.
  var LEFT_DENSITY = 2.025e-4;
  var LEFT_EXIT = 0.5;
  // Characters riding the edge: so many a second on a window as big across as
  // the one this was tuned on, more on a bigger one, so the edge looks the same;
  // and how far past it they drift before they fade.
  var RIDERS = 225;
  var TUNED_ACROSS = 774;
  var RIDER_REACH = 45;

  // The browser bar on a phone, which the page's own colour does not reach.
  var THEME = { windows: '#16110d', linux: '#0a120d' };

  var root = document.documentElement;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var busy = false;
  var atlas = null;
  /** The light and characters of the last change, while any are still showing. */
  var showing = null;

  // Said differently to somebody who is already on Linux.
  function onLinux() {
    var data = window.navigator.userAgentData;
    if (data && data.platform) return /linux/i.test(data.platform);
    var agent = window.navigator.userAgent || '';
    return /Linux/.test(agent) && !/Android/.test(agent);
  }
  var ask = onLinux() ? text.noticed : text.ask;

  /**
   * The scan lines under the green, drawn once to the screen's own pixels and
   * tiled. A repeating gradient left them uneven wherever a CSS pixel is not a
   * whole screen pixel, and the graphics card, drawing the page's ground as two
   * triangles, put their hard edges in slightly different places on each side
   * of the diagonal, so a seam ran from corner to corner. Here a line and the
   * gap after it are whole screen pixels, as near the 1 in 3 as the screen
   * allows, a little fainter where a line comes out thicker so the green stays
   * as deep. The tile holds as many lines as it takes to be a whole number of
   * CSS pixels too: the browser keeps sizes to 1/64 of one, so a tile of 3⅓
   * would creep a little further off the screen's pixels with every repeat.
   */
  var SCAN_PERIOD = 3;
  var SCAN_ALPHA = 0.055;
  var scanScale = 0;
  function scanLines() {
    var scale = window.devicePixelRatio || 1;
    if (scale === scanScale) return;
    scanScale = scale;
    var period = Math.max(2, Math.round(SCAN_PERIOD * scale));
    var line = Math.max(1, Math.round(period / SCAN_PERIOD));
    var lines = 1;
    function whole(value) {
      return Math.abs(value - Math.round(value)) < 1e-6;
    }
    while (lines < 64 && !whole((period * lines) / scale)) lines += 1;
    var tile = document.createElement('canvas');
    tile.height = period * lines;
    tile.width = tile.height * Math.ceil(32 / tile.height);
    var context = tile.getContext('2d');
    context.fillStyle = 'rgba(126, 231, 135, ' + ((SCAN_ALPHA * period) / SCAN_PERIOD / line).toFixed(4) + ')';
    for (var i = 0; i < lines; i++) context.fillRect(0, i * period, tile.width, line);
    root.style.setProperty('--linux-scan', 'url(' + tile.toDataURL() + ')');
    root.style.setProperty('--linux-scan-size', Math.round(tile.width / scale) + 'px ' + Math.round(tile.height / scale) + 'px');
  }
  scanLines();
  // Zooming, or the window going to another screen, changes the pixels.
  window.addEventListener('resize', scanLines);

  // Green is kept in the address as #linux and carried by the link to the
  // other language, so switching language, or reloading, stays green. The
  // pages' heads put it on before the first paint when they arrive with it.
  var KEEP = '#linux';
  var languages = document.querySelectorAll('.lang a[hreflang]');

  /** Everything that follows from being green or not, but the colours. */
  function reflect() {
    var green = root.classList.contains('linux');
    trigger.textContent = green ? text.back : ask;
    if (themeColor) themeColor.content = green ? THEME.linux : THEME.windows;
    var here = window.location.pathname + window.location.search;
    if ((window.location.hash === KEEP) !== green) window.history.replaceState(null, '', green ? here + KEEP : here);
    languages.forEach(function (link) {
      link.setAttribute('href', link.getAttribute('href').split('#')[0] + (green ? KEEP : ''));
    });
  }
  reflect();
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
        drift: (Math.random() - 0.5) * 2 * DRIFT,
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
    return Math.max(0, r * out);
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

  /** Points round the edge. */
  function outline(x, y, t, r, bend) {
    var points = [];
    for (var i = 0; i < POINTS; i++) {
      var angle = (i / POINTS) * Math.PI * 2;
      var reach = edge(angle, t, r, bend);
      points.push([x + Math.cos(angle) * reach, y + Math.sin(angle) * reach]);
    }
    return points;
  }

  /**
   * The edge as a smooth closed curve: from the middle of each side to the
   * middle of the next, bent towards the point between them. Calls `start`
   * with where it begins, then `curve` with each curve's control point and end.
   */
  function smooth(points, start, curve) {
    var n = points.length;
    var last = points[n - 1];
    start((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2);
    for (var i = 0; i < n; i++) {
      var at = points[i];
      var next = points[(i + 1) % n];
      curve(at[0], at[1], (at[0] + next[0]) / 2, (at[1] + next[1]) / 2);
    }
  }

  function pathData(points) {
    var parts = [];
    function f(value) {
      return value.toFixed(1);
    }
    smooth(
      points,
      function (x, y) {
        parts.push('M' + f(x) + ' ' + f(y));
      },
      function (cx, cy, x, y) {
        parts.push('Q' + f(cx) + ' ' + f(cy) + ' ' + f(x) + ' ' + f(y));
      },
    );
    return parts.join('') + 'Z';
  }

  function trace(context, points) {
    context.beginPath();
    smooth(
      points,
      function (x, y) {
        context.moveTo(x, y);
      },
      function (cx, cy, x, y) {
        context.quadraticCurveTo(cx, cy, x, y);
      },
    );
    context.closePath();
  }

  /** The whole run as clip-path keyframes, worked out before it starts. */
  function keyframes(x, y, full, growing, bend) {
    var frames = [];
    for (var s = 0; s <= STEPS; s++) {
      var t = s / STEPS;
      frames.push({ clipPath: "path('" + pathData(outline(x, y, t, radius(t, full, growing), bend)) + "')" });
    }
    return frames;
  }

  /**
   * Every character, drawn once, glowing, on a strip, so a frame copies little
   * pictures instead of setting type hundreds of times.
   */
  function glyphAtlas(scale) {
    var cell = Math.ceil(GLYPH_CELL * scale);
    var strip = document.createElement('canvas');
    strip.width = cell * GLYPHS.length;
    strip.height = cell;
    var context = strip.getContext('2d');
    context.font = GLYPH_FONT * scale + 'px ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(126, 231, 135, 0.9)';
    context.shadowBlur = 8 * scale;
    context.fillStyle = '#c9ffd0';
    for (var i = 0; i < GLYPHS.length; i++) context.fillText(GLYPHS[i], i * cell + cell / 2, cell / 2);
    return { strip: strip, cell: cell, scale: scale };
  }

  function anyGlyph() {
    return Math.floor(Math.random() * GLYPHS.length);
  }

  /** Now and then, a character turns into another. */
  function flicker(one, seconds, every, chance) {
    one.since += seconds;
    if (one.since < every) return;
    one.since = 0;
    if (Math.random() < chance) one.glyph = anyGlyph();
  }

  /**
   * The light and the characters for one change, on a canvas over the whole
   * window. It has a transition name of its own (linux.css), so the browser
   * keeps it out of the pictures of the page — where the blob would clip it —
   * and shows it live on top. It stays after the transition, for as long as
   * characters are still going.
   */
  function effect(x, y, growing, bend, full) {
    var scale = Math.min(2, window.devicePixelRatio || 1);
    if (!atlas || atlas.scale !== scale) atlas = glyphAtlas(scale);
    var w = window.innerWidth;
    var h = window.innerHeight;
    var canvas = document.createElement('canvas');
    canvas.className = 'linux-light';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    document.body.append(canvas);
    var context = canvas.getContext('2d');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.lineJoin = 'round';

    var sign = growing ? 1 : -1;
    var riderRate = (RIDERS * Math.hypot(w, h)) / TUNED_ACROSS;
    var riders = [];
    var left = [];
    var owedRiders = 0;
    var owedLeft = 0;
    var before = radius(0, full, growing);
    var last = null;
    var endedAt = null;
    var self = { stopped: false };

    function glyph(one, px, py) {
      var cell = atlas.cell;
      context.drawImage(
        atlas.strip,
        one.glyph * cell,
        0,
        cell,
        cell,
        px - GLYPH_CELL / 2,
        py - GLYPH_CELL / 2,
        GLYPH_CELL,
        GLYPH_CELL,
      );
    }

    /** Characters for the ground the edge covered since the last frame. */
    function leave(t, r) {
      owedLeft += Math.PI * Math.abs(r * r - before * before) * LEFT_DENSITY;
      var moved = Math.abs(r - before);
      before = r;
      while (owedLeft >= 1) {
        owedLeft -= 1;
        var angle = Math.random() * Math.PI * 2;
        var at = edge(angle, t, r, bend);
        // Behind the edge going out; going back, just ahead of it, inside the
        // green, for the edge to take as it passes.
        var from = growing ? at - Math.random() * (moved + 8) : at - 6 - Math.random() * Math.max(30, moved * 4);
        var px = x + Math.cos(angle) * from;
        var py = y + Math.sin(angle) * from;
        if (from < 0 || px < -10 || py < -10 || px > w + 10 || py > h + 10) continue;
        left.push({ x: px, y: py, age: 0, glyph: anyGlyph(), since: Math.random() * 0.15, late: Math.random() * 0.1 });
      }
    }

    function ride(seconds) {
      owedRiders += riderRate * seconds;
      while (owedRiders >= 1) {
        owedRiders -= 1;
        riders.push({
          angle: Math.random() * Math.PI * 2,
          start: 6 + GLOW * 0.15 + Math.random() * 8,
          drift: RIDER_REACH * (0.5 + Math.random() * 0.8),
          age: 0,
          life: 0.5 + Math.random() * 0.55,
          glyph: anyGlyph(),
          since: 0,
        });
      }
    }

    function light(points, t, r, strength) {
      trace(context, points);
      for (var i = 0; i < HALO.length; i++) {
        context.lineWidth = GLOW * HALO[i][0];
        context.strokeStyle = 'rgba(63, 185, 80, ' + (HALO[i][1] * strength).toFixed(3) + ')';
        context.stroke();
      }
      context.lineWidth = 1.6;
      context.strokeStyle = 'rgba(205, 255, 210, ' + (0.9 * strength).toFixed(3) + ')';
      context.stroke();

      for (var j = 0; j < RINGS; j++) {
        var along = (t * RING_PACE + j / RINGS) % 1;
        var fading = (1 - along) * (1 - along) * strength;
        trace(context, outline(x, y, t, Math.max(0, r + sign * along * GLOW * RING_REACH), bend));
        context.lineWidth = GLOW * 0.45;
        context.strokeStyle = 'rgba(63, 185, 80, ' + (0.1 * fading).toFixed(3) + ')';
        context.stroke();
        context.lineWidth = 1.2;
        context.strokeStyle = 'rgba(170, 255, 180, ' + (0.45 * fading).toFixed(3) + ')';
        context.stroke();
      }
    }

    /** One frame, `t` of the way through. Whether there is anything left to show. */
    self.draw = function (now, t) {
      var seconds = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= 1 && endedAt === null) {
        endedAt = now;
        // Past the window going out, swallowed by the blob going back.
        riders = [];
        if (!growing) left = [];
      }
      var ended = endedAt !== null;
      var r = radius(t, full, growing);
      var points = ended ? null : outline(x, y, t, r, bend);
      context.clearRect(0, 0, w, h);
      context.globalCompositeOperation = 'lighter';

      if (!ended) {
        leave(t, r);
        if (t < 0.85 && r > 1) ride(seconds);
      }

      // Going back, nothing shows outside the green that is left.
      var within = !growing && !ended;
      if (within) {
        context.save();
        trace(context, points);
        context.clip();
      }
      var strength = Math.max(0.35, BRIGHT);
      for (var i = riders.length - 1; i >= 0; i--) {
        var rider = riders[i];
        rider.age += seconds;
        var f = rider.age / rider.life;
        var out = rider.start + rider.drift * (1 - (1 - f) * (1 - f));
        var from = edge(rider.angle, t, r, bend) + sign * out;
        if (f >= 1 || from < 0) {
          riders.splice(i, 1);
          continue;
        }
        flicker(rider, seconds, 0.12, 0.45);
        context.globalAlpha = Math.min(1, f * 6) * (1 - f) * strength;
        glyph(rider, x + Math.cos(rider.angle) * from, y + Math.sin(rider.angle) * from);
      }
      var gone = ended ? (now - endedAt) / 1000 : 0;
      for (var k = left.length - 1; k >= 0; k--) {
        var one = left[k];
        one.age += seconds;
        flicker(one, seconds, 0.16, 0.3);
        // Bright while the light is on them, then settled, until they go.
        var alpha = growing ? 0.5 + 0.5 * Math.exp(-one.age / 0.25) : Math.min(1, one.age / 0.1) * 0.75;
        if (ended) {
          var going = (gone - one.late) / LEFT_EXIT;
          if (going >= 1) {
            left.splice(k, 1);
            continue;
          }
          if (going > 0) alpha *= 1 - going;
        }
        context.globalAlpha = alpha * Math.max(0.4, BRIGHT);
        glyph(one, one.x, one.y);
      }
      context.globalAlpha = 1;
      if (within) context.restore();

      if (!ended && r > 1) light(points, t, r, BRIGHT * Math.min(1, t / 0.06) * (t > 0.8 ? (1 - t) / 0.2 : 1));
      return !ended || left.length > 0;
    };

    self.stop = function () {
      self.stopped = true;
      canvas.remove();
    };
    return self;
  }

  function change() {
    root.classList.toggle('linux');
    reflect();
  }

  /** Put the green on, or take it off, spreading from (x, y). */
  function toggle(x, y) {
    if (busy) return;
    if (reduced || !document.startViewTransition) {
      change();
      return;
    }
    // Characters still going from the last change go at once.
    if (showing) showing.stop();
    busy = true;
    var growing = !root.classList.contains('linux');
    var bend = waves();
    var full = farthest(x, y) * REACH;
    var fx = effect(x, y, growing, bend, full);
    showing = fx;
    // Which picture the blob clips, and so which goes on top; see linux.css.
    root.setAttribute('data-linux-going', growing ? 'in' : 'out');

    var transition = document.startViewTransition(change);
    var running = null;
    var done = false;

    function frame(now) {
      if (fx.stopped) return;
      // The browser's own clock for the blob, so the light stays on its edge
      // even when a frame comes late.
      var t = done ? 1 : Math.min(1, (Number(running.currentTime) || 0) / DURATION);
      if (fx.draw(now, t)) window.requestAnimationFrame(frame);
      else fx.stop();
    }

    transition.ready
      .then(function () {
        running = root.animate(keyframes(x, y, full, growing, bend), {
          duration: DURATION,
          easing: 'linear',
          fill: 'forwards',
          pseudoElement: growing ? '::view-transition-new(root)' : '::view-transition-old(root)',
        });
        window.requestAnimationFrame(frame);
        // Over when the blob has run, or sooner if the browser cut it short.
        return Promise.race([running.finished, transition.finished]);
      })
      .catch(function () {
        // Skipped (the tab went to the background, say): the page has changed
        // all the same, just without the blob.
      })
      .then(function () {
        done = true;
        transition.skipTransition();
        return transition.finished;
      })
      .catch(function () {})
      .then(function () {
        // Held at its last frame until now, so the pictures never showed
        // unclipped between the blob ending and the transition.
        if (running) running.cancel();
        else fx.stop();
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
