/**
 * A number on wheels, like an old odometer: each place is a strip of digits
 * that rolls to its figure, up as the number grows and down as it falls.
 *
 * Each strip carries every value its place passes through rather than the ten
 * digits once, so a place that goes past 9 keeps rolling the same way into 0
 * instead of spinning back down through all of them: the ones are a strip of
 * one digit per unit, the tens one per ten, and so on.
 */
export function RollingNumber({ value, max }: { value: number; max: number }) {
  const whole = Math.max(0, Math.round(value));
  const places = String(max).length;
  const shown = String(whole).length;
  return (
    <span className="groove-rolling" aria-hidden="true">
      {Array.from({ length: places }, (_, i) => {
        const place = 10 ** (places - 1 - i);
        const used = places - i <= shown;
        const index = Math.floor(whole / place);
        const length = Math.floor(max / place) + 1;
        return (
          <span key={place} className={`groove-rolling-place ${used ? '' : 'is-unused'}`}>
            <span className="groove-rolling-strip" style={{ transform: `translateY(${-index}em)` }}>
              {Array.from({ length }, (_, n) => (
                <span key={n}>{n % 10}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
