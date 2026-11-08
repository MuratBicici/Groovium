import { describe, expect, it, vi } from 'vitest';
import { askUntilItWorks } from './tabTap';

const refused = (name: string) => new DOMException('no', name);
const stream = {} as MediaStream;
const always = () => true;

describe('asking for a capture', () => {
  it('asks again after a refusal that passes, and takes what it gets', async () => {
    const ask = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(refused('NotReadableError'))
      .mockRejectedValueOnce(refused('AbortError'))
      .mockResolvedValue(stream);
    await expect(askUntilItWorks(ask, always, 0)).resolves.toBe(stream);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('gives up in the end, and says why', async () => {
    const ask = vi.fn<() => Promise<MediaStream>>().mockRejectedValue(refused('NotReadableError'));
    await expect(askUntilItWorks(ask, always, 0)).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it('does not ask again when it is refused on principle', async () => {
    const ask = vi.fn<() => Promise<MediaStream>>().mockRejectedValue(refused('NotAllowedError'));
    await expect(askUntilItWorks(ask, always, 0)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('stops asking once it is no longer wanted', async () => {
    const ask = vi.fn<() => Promise<MediaStream>>().mockRejectedValue(refused('NotReadableError'));
    await expect(askUntilItWorks(ask, () => false, 0)).resolves.toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
