// "On Linux?" — a terminal that opens over the page from wherever it was
// pressed.
//
// The terminal is a layer of its own over everything, revealed by a clip-path
// that grows from the press: not a circle but a blob, its edge the sum of a
// few sine waves whose phases drift as it grows, so the edge boils. Characters
// fly along that edge on a canvas above it. "$ exit" plays it backwards.
//
// A layer rather than a View Transition. What it reveals is different content
// anyway, a clip on our own element looks the same, and it works the same in
// every browser and on a phone without a snapshot of the page or a second way
// of doing it for browsers without one.
(function () {
  var trigger = document.querySelector('[data-linux-open]');
  if (!trigger || !window.requestAnimationFrame) return;

  // Everything the terminal says, in both languages, in one place. The command
  // and the slogan are placeholders until the real ones are chosen.
  var TEXT = {
    en: {
      ask: 'On Linux?',
      noticed: 'Looks like you’re on Linux',
      title: 'groovium-lite — bash',
      prompt: 'you@groovium:~$ ',
      command: 'sudo apt install ./groovium-lite_amd64.deb',
      output: [
        'So you are nerd enough to use Linux.',
        'Then you may want to use your local much more.',
      ],
      soon: '[ coming soon ]',
      copy: 'copy',
      exit: '$ exit',
      follow: 'Follow the releases on GitHub',
      anywhere: 'any distribution',
    },
    tr: {
      ask: 'Linux mu kullanıyorsunuz?',
      noticed: 'Linux’ta olduğunu fark ettik',
      title: 'groovium-lite — bash',
      prompt: 'sen@groovium:~$ ',
      command: 'sudo apt install ./groovium-lite_amd64.deb',
      output: [
        'So you are nerd enough to use Linux.',
        'Then you may want to use your local much more.',
      ],
      soon: '[ yakında ]',
      copy: 'kopyala',
      exit: '$ exit',
      follow: 'Sürümleri GitHub’da takip et',
      anywhere: 'her dağıtım',
    },
  };
  var text = document.documentElement.lang === 'tr' ? TEXT.tr : TEXT.en;

  var CARDS = [
    { name: '.deb', for: 'Ubuntu / Debian', cmd: 'sudo apt install ./groovium-lite_amd64.deb' },
    { name: '.rpm', for: 'Fedora', cmd: 'sudo dnf install ./groovium-lite.x86_64.rpm' },
    { name: 'AppImage', for: text.anywhere, cmd: 'chmod +x Groovium-Lite.AppImage' },
    {
      name: 'Flatpak',
      for: 'Flathub',
      cmd: 'flatpak install flathub io.github.muratbicici.GrooviumLite',
      copy: true,
    },
  ];

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
  var GLYPHS = '01#$%&*+=/\\|<>{}[]~^:;?!@';
  var FLYING = 110;
  var GREEN = '63, 185, 80';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var busy = false;
  var open = false;
  var layer = null;
  var canvas = null;
  var typing = [];

  // Said differently to somebody who is already on Linux.
  function onLinux() {
    var data = window.navigator.userAgentData;
    if (data && data.platform) return /linux/i.test(data.platform);
    var agent = window.navigator.userAgent || '';
    return /Linux/.test(agent) && !/Android/.test(agent);
  }

  trigger.textContent = onLinux() ? text.noticed : text.ask;
  trigger.hidden = false;

  function element(tag, className, content) {
    var made = document.createElement(tag);
    if (className) made.className = className;
    if (content) made.textContent = content;
    return made;
  }

  /** The terminal, built once on the first press. */
  function build() {
    if (layer) return;
    layer = element('div', 'linux');
    layer.id = 'linux';
    layer.hidden = true;
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'linux-title');

    var inner = element('div', 'linux-inner');
    var bar = element('div', 'linux-bar');
    var lights = element('span', 'linux-lights');
    lights.setAttribute('aria-hidden', 'true');
    lights.append(element('span'), element('span'), element('span'));
    var title = element('span', 'linux-title', text.title);
    title.id = 'linux-title';
    var exit = element('button', 'linux-exit', text.exit);
    exit.type = 'button';
    exit.addEventListener('click', function (event) {
      var from = event.detail ? [event.clientX, event.clientY] : middleOf(exit);
      close(from[0], from[1]);
    });
    bar.append(lights, title, exit);

    var term = element('pre', 'linux-term');
    term.append(
      element('span', 'linux-prompt', text.prompt),
      element('span', 'linux-command'),
      element('span', 'linux-cursor'),
      element('span', 'linux-output'),
    );
    term.querySelector('.linux-cursor').setAttribute('aria-hidden', 'true');

    var cards = element('div', 'linux-cards');
    CARDS.forEach(function (card) {
      var box = element('div', 'linux-card');
      var head = element('div', 'linux-card-head');
      head.append(element('span', 'linux-card-name', card.name), element('span', 'linux-card-for', card.for));
      var foot = element('div', 'linux-card-foot');
      foot.append(element('span', 'linux-soon', text.soon));
      if (card.copy) {
        var copy = element('button', 'linux-copy', text.copy);
        copy.type = 'button';
        // Nothing to copy until it is on Flathub.
        copy.disabled = true;
        foot.append(copy);
      }
      var command = element('code', 'linux-card-cmd', '$ ' + card.cmd);
      // Cut short with an ellipsis where it does not fit; all of it on hover.
      command.title = card.cmd;
      box.append(head, command, foot);
      cards.append(box);
    });

    var follow = element('p', 'linux-follow');
    var link = element('a', '', text.follow);
    link.href = 'https://github.com/MuratBicici/Groovium/releases';
    follow.append(link);

    inner.append(bar, term, cards, follow);
    layer.append(inner);
    document.body.append(layer);

    canvas = element('canvas', 'linux-ascii');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    document.body.append(canvas);

    layer.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var from = middleOf(exit);
      close(from[0], from[1]);
    });
  }

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

  /** The canvas sized to the window, at no more than twice its pixels. */
  function fitCanvas() {
    var scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    var context = canvas.getContext('2d');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return context;
  }

  /**
   * Grow the blob from (x, y), or shrink it back there, and call `then` at the
   * end. `growing` says which.
   */
  function play(x, y, growing, then) {
    var bend = waves();
    var full = farthest(x, y) * REACH;
    var context = fitCanvas();
    canvas.hidden = false;
    var start = window.performance.now();

    function frame(now) {
      var t = Math.min(1, (now - start) / DURATION);
      var eased = ease(t);
      var r = full * (growing ? eased : 1 - eased);

      var points = [];
      for (var i = 0; i < POINTS; i++) {
        var angle = (i / POINTS) * Math.PI * 2;
        var reach = Math.max(0, edge(angle, t, r, bend));
        points.push(
          (x + Math.cos(angle) * reach).toFixed(1) + 'px ' + (y + Math.sin(angle) * reach).toFixed(1) + 'px',
        );
      }
      layer.style.clipPath = 'polygon(' + points.join(',') + ')';

      // The characters, new every frame: just inside the edge and some way past
      // it, fainter the further from it, and gone over the last stretch.
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      var fade = t > 0.85 ? (1 - t) / 0.15 : 1;
      if (fade > 0 && r > 1) {
        context.font = '14px ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (var c = 0; c < FLYING; c++) {
          var at = Math.random() * Math.PI * 2;
          var off = -12 + Math.random() * 40;
          var from = edge(at, t, r, bend) + off;
          var cx = x + Math.cos(at) * from;
          var cy = y + Math.sin(at) * from;
          if (cx < -20 || cy < -20 || cx > window.innerWidth + 20 || cy > window.innerHeight + 20) continue;
          var near = 1 - Math.abs(off) / 28;
          context.fillStyle = 'rgba(' + GREEN + ',' + (Math.max(0.08, near) * fade).toFixed(3) + ')';
          context.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], cx, cy);
        }
      }

      if (t < 1) {
        window.requestAnimationFrame(frame);
        return;
      }
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      canvas.hidden = true;
      then();
    }
    window.requestAnimationFrame(frame);
  }

  /** Everything but the terminal, out of reach while it is open. */
  function setPageInert(inert) {
    for (var i = 0; i < document.body.children.length; i++) {
      var child = document.body.children[i];
      if (child === layer || child === canvas || child.tagName === 'SCRIPT') continue;
      if (inert) child.setAttribute('inert', '');
      else child.removeAttribute('inert');
    }
    document.documentElement.style.overflow = inert ? 'hidden' : '';
  }

  function stopTyping() {
    typing.forEach(function (id) {
      window.clearTimeout(id);
    });
    typing = [];
  }

  /** Type the command, then the output, then bring the cards in. */
  function type() {
    var command = layer.querySelector('.linux-command');
    var output = layer.querySelector('.linux-output');
    var cards = layer.querySelectorAll('.linux-card');
    var follow = layer.querySelector('.linux-follow');
    var cursor = layer.querySelector('.linux-cursor');
    stopTyping();
    command.textContent = '';
    output.textContent = '';
    cards.forEach(function (card) {
      card.classList.remove('shown');
    });
    follow.classList.remove('shown');
    command.after(cursor);

    function reveal() {
      cards.forEach(function (card, at) {
        typing.push(
          window.setTimeout(
            function () {
              card.classList.add('shown');
            },
            reduced ? 0 : at * 120,
          ),
        );
      });
      typing.push(
        window.setTimeout(
          function () {
            follow.classList.add('shown');
          },
          reduced ? 0 : cards.length * 120,
        ),
      );
    }

    function answer() {
      output.after(cursor);
      text.output.forEach(function (line, at) {
        typing.push(
          window.setTimeout(
            function () {
              output.append((at ? '\n' : '') + line);
              if (at === text.output.length - 1) reveal();
            },
            reduced ? 0 : 260 + at * 140,
          ),
        );
      });
    }

    if (reduced) {
      command.textContent = text.command;
      answer();
      return;
    }
    var typed = 0;
    function next() {
      typed += 1;
      command.textContent = text.command.slice(0, typed);
      if (typed < text.command.length) {
        typing.push(window.setTimeout(next, 22 + Math.random() * 30));
      } else {
        answer();
      }
    }
    typing.push(window.setTimeout(next, 280));
  }

  function show(x, y) {
    if (busy || open) return;
    busy = true;
    build();
    layer.hidden = false;
    setPageInert(true);
    if (reduced) {
      layer.style.clipPath = '';
      finishOpening();
      return;
    }
    layer.style.clipPath = 'polygon(' + x + 'px ' + y + 'px)';
    play(x, y, true, function () {
      layer.style.clipPath = '';
      finishOpening();
    });
  }

  function finishOpening() {
    busy = false;
    open = true;
    layer.querySelector('.linux-exit').focus({ preventScroll: true });
    type();
  }

  function close(x, y) {
    if (busy || !open) return;
    busy = true;
    stopTyping();
    function finish() {
      layer.hidden = true;
      layer.style.clipPath = '';
      layer.scrollTop = 0;
      setPageInert(false);
      busy = false;
      open = false;
      trigger.focus({ preventScroll: true });
    }
    if (reduced) {
      finish();
      return;
    }
    play(x, y, false, finish);
  }

  trigger.addEventListener('click', function (event) {
    var from = event.detail ? [event.clientX, event.clientY] : middleOf(trigger);
    show(from[0], from[1]);
  });
})();
