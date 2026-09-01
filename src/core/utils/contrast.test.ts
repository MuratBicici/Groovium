import { describe, expect, it } from 'vitest';
import { hsvToHex, luminance, parseHex, rgbToOklab, type Oklab, type Rgb } from './colour';
import {
  BOOSTED_TARGETS,
  NORMAL_TARGETS,
  contrastRatio,
  derivePalette,
  isLightGround,
  strengthenText,
  towardReadable,
} from './contrast';

/**
 * The fault this file exists for: the custom palette mixed its text from the
 * surface *toward white*, so a light surface produced light text on a light
 * ground. The stylesheet could not check its own work, and the panel only
 * warned. Every target below is measured rather than eyeballed.
 */

const rgb = (hex: string): Rgb => parseHex(hex) as Rgb;

/** Hue in degrees, for asking whether a shade is still the same colour. */
const hueAngle = ({ a, b }: Oklab): number => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const WHITE = rgb('#ffffff');
const BLACK = rgb('#000000');

/** A light surface, which is what used to break. */
const LIGHT_SURFACE = '#f0e6d8';
/** Espresso's own two colours: the palette should land back near Espresso. */
const ESPRESSO = { primary: '#2e231b', secondary: '#c8945a' };

describe('contrastRatio', () => {
  it('matches the values WCAG itself quotes', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // #767676 on white is the canonical "just passes 4.5" example.
    expect(contrastRatio(rgb('#767676'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rgb('#777777'), WHITE)).toBeLessThan(4.5);
  });

  it('does not care which way round it is asked', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(contrastRatio(WHITE, BLACK), 10);
  });
});

describe('isLightGround', () => {
  it('is decided by which end actually wins, not by a guess at the middle', () => {
    expect(isLightGround(WHITE)).toBe(true);
    expect(isLightGround(BLACK)).toBe(false);
    expect(isLightGround(rgb(LIGHT_SURFACE))).toBe(true);
    expect(isLightGround(rgb(ESPRESSO.primary))).toBe(false);
  });

  it('puts the crossover near 0.18, not near the middle', () => {
    // Worth pinning because it is counter-intuitive: #808080 *looks* like the
    // midpoint and is already on the light side, while a grey two shades down
    // is still dark. Anything that guessed at a luminance of 0.5 would get the
    // whole band between them backwards.
    expect(luminance(rgb('#808080'))).toBeGreaterThan(0.18);
    expect(isLightGround(rgb('#808080'))).toBe(true);

    expect(luminance(rgb('#6b6b6b'))).toBeLessThan(0.18);
    expect(isLightGround(rgb('#6b6b6b'))).toBe(false);
  });
});

describe('towardReadable', () => {
  it('walks toward white on a dark ground', () => {
    const found = towardReadable(rgb('#2e231b'), rgb('#3d2f24'), 4.5) as Rgb;
    expect(found).not.toBeNull();
    expect(luminance(found)).toBeGreaterThan(luminance(rgb('#3d2f24')));
  });

  it('walks toward black on a light ground', () => {
    // The heart of the repair. The old code only ever went toward white.
    const surface = rgb(LIGHT_SURFACE);
    const found = towardReadable(surface, rgb('#e8dccb'), 4.5) as Rgb;
    expect(found).not.toBeNull();
    expect(luminance(found)).toBeLessThan(luminance(surface));
  });

  it('actually reaches the target it was given', () => {
    for (const target of [3, 4.5, 7]) {
      for (const surface of ['#2e231b', LIGHT_SURFACE, '#1b2740', '#808080']) {
        const found = towardReadable(rgb(surface), rgb(surface), target);
        if (found === null) continue;
        expect(contrastRatio(rgb(surface), found), `${surface} @ ${target}`).toBeGreaterThanOrEqual(
          target,
        );
      }
    }
  });

  it('leaves a colour alone when it already reads', () => {
    expect(towardReadable(BLACK, WHITE, 4.5)).toEqual(WHITE);
  });

  it('says so rather than returning a near miss', () => {
    // A mid-tone tops out well below 21:1. Handing back the closest colour and
    // calling it a pass is how an unreadable palette ships.
    expect(towardReadable(rgb('#767676'), rgb('#767676'), 21)).toBeNull();
  });
});

describe('derivePalette', () => {
  /** Every text role clears its target against every surface shade. */
  const checkReadable = (hex: string, boost = false) => {
    const derived = derivePalette(hex, '#c8945a', boost);
    expect(derived, hex).not.toBeNull();
    const { variables } = derived!;

    const targets = boost ? BOOSTED_TARGETS : NORMAL_TARGETS;
    const surfaces = ['700', '800', '900'].map((s) => rgb(variables[`--color-shell-${s}`] as string));
    const roles: [string, number][] = [
      ['--color-cream-50', targets.strong],
      ['--color-cream-200', targets.body],
      ['--color-cream-400', targets.quiet],
    ];

    /** The worst this colour does across every surface it has to serve. */
    const worst = (colour: Rgb) =>
      surfaces.reduce((low, surface) => Math.min(low, contrastRatio(surface, colour)), Infinity);

    // One colour has to work on all three shades, so the best any colour could
    // possibly manage is the better of the two ends' *worst* case — not each
    // surface's own ceiling, which no single colour can hit at once. Some
    // palettes cannot reach every target at all: a mid-tone maroon tops out
    // near 6.9, so 7:1 is not available on it. The requirement is the target
    // or that ceiling, whichever is lower — never a colour chosen without
    // checking, which is what the stylesheet's blind mix produced.
    const ceiling = Math.max(worst(WHITE), worst(BLACK));

    for (const [name, target] of roles) {
      const colour = rgb(variables[name] as string);
      expect(worst(colour), `${hex} ${name}`).toBeGreaterThanOrEqual(Math.min(target, ceiling) - 0.01);
    }
  };

  it('makes light surfaces readable — the case that was broken', () => {
    const derived = derivePalette(LIGHT_SURFACE, '#8a5a2b');
    expect(derived).not.toBeNull();
    expect(derived!.lightGround).toBe(true);

    // Text must be darker than the surface it sits on. The old derivation
    // produced the opposite and there was nothing to catch it.
    const surface = rgb(derived!.variables['--color-shell-700'] as string);
    for (const name of ['--color-cream-50', '--color-cream-200', '--color-cream-400']) {
      const text = rgb(derived!.variables[name] as string);
      expect(luminance(text), name).toBeLessThan(luminance(surface));
    }
    checkReadable(LIGHT_SURFACE);
  });

  it('keeps the palette in its light text instead of going to pure black', () => {
    // Running the dark fractions toward black gave `#010101` — a heading with
    // no trace of the chosen colour left in it, harsher than the dark side's
    // near-white and further from where it started.
    const { variables } = derivePalette(LIGHT_SURFACE, '#8a5a2b')!;
    const heading = rgb(variables['--color-cream-50'] as string);

    expect(luminance(heading)).toBeGreaterThan(0.002);
    // Still recognisably warm: the red channel keeps a lead over the blue, the
    // way the cream surface it came from does.
    expect(heading.r).toBeGreaterThan(heading.b);
  });

  it('keeps a recess darker than its surface, on either ground', () => {
    // shell-900 paints the well behind the platter and the inside of every
    // input. Inverting the ramp on a light surface made it *lighter* than the
    // shell, which reads as something raised rather than something cut into.
    // Depth is not a theme; only text changes direction.
    for (const surface of [LIGHT_SURFACE, ESPRESSO.primary, '#ffffff', '#1b2740']) {
      const { variables } = derivePalette(surface, '#c8945a')!;
      const at = (shade: string) => luminance(rgb(variables[`--color-shell-${shade}`] as string));

      expect(at('900'), `${surface} 900`).toBeLessThan(at('800'));
      expect(at('800'), `${surface} 800`).toBeLessThan(at('700'));
      // 600 is the raised shade — the lit centre of the platter mat — and on a
      // pure white shell there is nothing above it to move into. Equal rather
      // than lighter is the honest answer there; inverting it would make the
      // raised shade darker than the surface, which is the fault this test is
      // about, in the other direction.
      expect(at('700'), `${surface} 700`).toBeLessThanOrEqual(at('600'));
    }
  });

  it('separates a light palette by a little, not by half the scale', () => {
    // Half way to black from a near-white shell is a mid grey — a hole rather
    // than a recess. Light interfaces separate their depths by a few percent.
    const { variables } = derivePalette(LIGHT_SURFACE, '#8a5a2b')!;
    const drop = contrastRatio(
      rgb(variables['--color-shell-700'] as string),
      rgb(variables['--color-shell-900'] as string),
    );
    expect(drop).toBeLessThan(1.5);
    expect(drop).toBeGreaterThan(1.02);
  });

  it('holds every target across the whole hue circle', () => {
    // Two free colours can be any two colours, so the sweep is the test.
    for (let hue = 0; hue < 360; hue += 15) {
      for (const [s, v] of [
        [70, 18],
        [40, 50],
        [90, 92],
        [8, 96],
      ] as const) {
        checkReadable(hsvToHex({ h: hue, s, v }));
      }
    }
  });

  it('holds the raised targets too', () => {
    for (let hue = 0; hue < 360; hue += 45) {
      checkReadable(hsvToHex({ h: hue, s: 60, v: 22 }), true);
    }
  });

  it('gives a dark palette bright text, not just passing text', () => {
    // Stopping the moment the target is met is accessible and looks wrong: it
    // produced a flat grey heading at exactly 7:1 where Espresso itself has a
    // warm near-white at 13. The proportions decide the look; measurement is
    // only ever a floor under it.
    const { variables } = derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!;
    const heading = rgb(variables['--color-cream-50'] as string);

    expect(luminance(heading)).toBeGreaterThan(0.7);
    expect(
      contrastRatio(rgb(variables['--color-shell-700'] as string), heading),
    ).toBeGreaterThan(11);
  });

  it('keeps the accent shades in the accent, whatever was chosen', () => {
    // The 1.0.3 fault, and the one nothing here was watching. brass-600 fills
    // the play button, the record label, the tonearm and every panel button,
    // and it was derived as "a colour with 4.5:1 against the accent" — a text
    // colour definition applied to a fill. A dark blue gave a pale blue button;
    // a light yellow gave a dark olive one.
    for (const accent of ['#2f5fa8', '#d9c04a', '#c8945a', '#e29ab1', '#1d5c3a']) {
      const { variables } = derivePalette('#2e231b', accent)!;
      const chosen = rgbToOklab(rgb(accent));

      for (const shade of ['400', '500', '600']) {
        const got = rgbToOklab(rgb(variables[`--color-brass-${shade}`] as string));
        // Same hue angle: it is a lighter or darker version of their colour,
        // not a different colour that happens to contrast well.
        const turned = Math.abs(hueAngle(got) - hueAngle(chosen));
        expect(Math.min(turned, 360 - turned), `${accent} brass-${shade}`).toBeLessThan(6);
      }

      // And lighter, the same, darker — in that order.
      const lightness = ['400', '500', '600'].map((s) =>
        rgbToOklab(rgb(variables[`--color-brass-${s}`] as string)).L,
      );
      expect(lightness[0], accent).toBeGreaterThan(lightness[1] as number);
      expect(lightness[1], accent).toBeGreaterThan(lightness[2] as number);
    }
  });

  it('reproduces the hand-written accent shades it was modelled on', () => {
    // Espresso's own brass ramp, to within a couple of units per channel.
    const { variables } = derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!;
    const near = (got: string, want: string, tolerance: number) => {
      const a = rgb(got);
      const b = rgb(want);
      expect(
        Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b),
        `${got} vs ${want}`,
      ).toBeLessThan(tolerance);
    };
    near(variables['--color-brass-400'] as string, '#e0b071', 30);
    near(variables['--color-brass-600'] as string, '#a2743f', 30);
  });

  it('draws icons on an accent fill in something that reads on it', () => {
    for (const accent of ['#2f5fa8', '#d9c04a', '#c8945a', '#ffffff', '#000000']) {
      const { variables } = derivePalette('#2e231b', accent)!;
      const onAccent = rgb(variables['--color-on-accent'] as string);

      // Both shades a button fills with, because it hovers between them.
      for (const shade of ['500', '600']) {
        const fill = rgb(variables[`--color-brass-${shade}`] as string);
        expect(contrastRatio(fill, onAccent), `${accent} on brass-${shade}`).toBeGreaterThanOrEqual(
          4.4,
        );
      }
    }
  });

  it('goes dark on a light accent and light on a dark one', () => {
    // The behaviour asked for in as many words: dark blue gets white glyphs,
    // light yellow gets black ones.
    const onDarkBlue = rgb(derivePalette('#2e231b', '#2f5fa8')!.variables['--color-on-accent'] as string);
    const onLightYellow = rgb(derivePalette('#2e231b', '#d9c04a')!.variables['--color-on-accent'] as string);

    expect(luminance(onDarkBlue)).toBeGreaterThan(0.5);
    expect(luminance(onLightYellow)).toBeLessThan(0.1);
  });

  it('never alters the two colours it was given', () => {
    // Somebody picked these. Everything else is derived; these come back whole.
    const derived = derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!;
    expect(derived.variables['--color-shell-700']).toBe(ESPRESSO.primary);
    expect(derived.variables['--color-brass-500']).toBe(ESPRESSO.secondary);
  });

  it('lands back near Espresso when built from Espresso', () => {
    // What makes the custom palette a sane place to start adjusting from.
    const derived = derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!;
    const near = (got: string, want: string, tolerance: number) => {
      const a = rgb(got);
      const b = rgb(want);
      const distance = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
      expect(distance, `${got} vs ${want}`).toBeLessThan(tolerance);
    };
    near(derived.variables['--color-shell-900'] as string, '#16110d', 40);
    near(derived.variables['--color-shell-600'] as string, '#3d2f24', 40);
  });

  it('reports an accent that cannot read rather than changing it', () => {
    // The one failure it must not repair: repairing it means overruling the
    // colour somebody chose.
    const invisible = derivePalette('#2e231b', '#332820')!;
    expect(invisible.accentUnreadable).toBe(true);
    expect(invisible.variables['--color-brass-500']).toBe('#332820');

    expect(derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!.accentUnreadable).toBe(false);
  });

  it('refuses a colour it cannot read', () => {
    expect(derivePalette('nonsense', '#c8945a')).toBeNull();
    expect(derivePalette('#2e231b', '')).toBeNull();
  });
});

describe('the hairline around a recess', () => {
  const edgeOf = (surface: string, boost = false) => {
    const { variables } = derivePalette(surface, '#c8945a', boost)!;
    const edge = rgb(variables['--color-edge'] as string);
    // The recess fill and the panel behind it. `shell-700` is not measured
    // against on purpose — see `edgeFor`.
    const worst = ['900', '800']
      .map((s) => contrastRatio(rgb(variables[`--color-shell-${s}`] as string), edge))
      .reduce((low, r) => Math.min(low, r), Infinity);
    return { hex: variables['--color-edge'] as string, worst };
  };

  it('stays visible on a surface with no room left to go darker', () => {
    // The reported fault. Every cue that says "this is an input" is darker than
    // its surroundings — the fill, the inset shadow — and on a near-black
    // surface there is no darker. The old ring was `shell-600`, a small lift,
    // which on those colours barely moves: it measured 1.12:1 against its own
    // fill, and 1.01 at pure black. The box stopped existing.
    for (const surface of ['#0a0a0c', '#050505', '#000000', '#100c14']) {
      expect(edgeOf(surface).worst, surface).toBeGreaterThanOrEqual(1.34);
    }
  });

  it('leaves a palette alone when its ring already reads', () => {
    // The five hand-written ones sit between 1.34 and 1.73, which is the soft
    // edge this app is drawn with. Lifting those would be repainting a design
    // rather than repairing a fault.
    const { variables } = derivePalette(ESPRESSO.primary, ESPRESSO.secondary)!;
    const edge = rgb(variables['--color-edge'] as string);
    const ring = rgb(variables['--color-shell-600'] as string);
    const moved = Math.abs(edge.r - ring.r) + Math.abs(edge.g - ring.g) + Math.abs(edge.b - ring.b);
    expect(moved).toBeLessThan(6);
  });

  it('goes lighter, since darker is the direction that ran out', () => {
    const surface = '#050505';
    const { hex } = edgeOf(surface);
    expect(luminance(rgb(hex))).toBeGreaterThan(luminance(rgb(surface)));
  });

  it('reaches the accessible floor when readability is turned up', () => {
    // 3:1 is WCAG's minimum for the boundary of a UI component. An edge is
    // drawn over a surface rather than being one of the palette's colours, so
    // raising it is that setting doing its job.
    for (const surface of ['#2e231b', '#050505', '#f0e6d8']) {
      expect(edgeOf(surface, true).worst, surface).toBeGreaterThanOrEqual(2.99);
    }
  });

  it('is still not a palette colour, so boost may move it', () => {
    const plain = derivePalette('#2e231b', '#c8945a', false)!.variables;
    const boosted = derivePalette('#2e231b', '#c8945a', true)!.variables;
    expect(boosted['--color-shell-600']).toBe(plain['--color-shell-600']);
    expect(boosted['--color-edge']).not.toBe(plain['--color-edge']);
  });
});

describe('increase readability', () => {
  it('does not move one palette colour', () => {
    // The complaint, asserted directly. 1.0.3 raised the accent targets along
    // with the text ones, so switching this on repainted buttons somebody had
    // chosen the colour of.
    for (const [surface, accent] of [
      ['#2e231b', '#c8945a'],
      ['#f0e6d8', '#8a5a2b'],
      ['#12203a', '#2f5fa8'],
    ] as const) {
      const plain = derivePalette(surface, accent, false)!.variables;
      const boosted = derivePalette(surface, accent, true)!.variables;

      for (const name of [
        '--color-shell-900',
        '--color-shell-800',
        '--color-shell-700',
        '--color-shell-600',
        '--color-brass-400',
        '--color-brass-500',
        '--color-brass-600',
      ]) {
        expect(boosted[name], `${surface}/${accent} ${name}`).toBe(plain[name]);
      }
    }
  });

  it('does move the text, which is the whole of what it is for', () => {
    const plain = derivePalette('#2e231b', '#c8945a', false)!.variables;
    const boosted = derivePalette('#2e231b', '#c8945a', true)!.variables;
    expect(boosted['--color-cream-400']).not.toBe(plain['--color-cream-400']);
  });
});

describe('strengthenText', () => {
  const SURFACES = [rgb('#2e231b'), rgb('#211913'), rgb('#16110d')];
  const TEXT = { strong: rgb('#f6efe4'), body: rgb('#ddd0bb'), quiet: rgb('#a9977e') };

  it('leaves a calibrated palette alone at the normal targets', () => {
    // Espresso already clears 7 / 4.5 / 3. Nothing should move.
    const same = strengthenText(SURFACES, TEXT, false);
    expect(same['--color-cream-50']).toBe('#f6efe4');
    expect(same['--color-cream-200']).toBe('#ddd0bb');
  });

  it('raises what falls short once the targets go up', () => {
    const boosted = strengthenText(SURFACES, TEXT, true);
    const worst = (hex: string) =>
      SURFACES.reduce((low, s) => Math.min(low, contrastRatio(s, rgb(hex))), Infinity);

    expect(worst(boosted['--color-cream-400'] as string)).toBeGreaterThanOrEqual(
      BOOSTED_TARGETS.quiet,
    );
    expect(worst(boosted['--color-cream-200'] as string)).toBeGreaterThanOrEqual(
      BOOSTED_TARGETS.body,
    );
  });

  it('actually changes something on a calibrated palette', () => {
    // The failure this guards against is a setting that does nothing. The
    // first set of boosted targets was one grade above AAA, and every
    // hand-written palette here already cleared all of them — so switching
    // "increase readability" on moved no pixel at all.
    const boosted = strengthenText(SURFACES, TEXT, true);
    expect(boosted['--color-cream-400']).not.toBe('#a9977e');
    expect(luminance(rgb(boosted['--color-cream-400'] as string))).toBeGreaterThan(
      luminance(TEXT.quiet),
    );
  });

  it('has nothing to say about a palette it cannot see', () => {
    expect(strengthenText([], TEXT, true)).toEqual({});
  });
});
