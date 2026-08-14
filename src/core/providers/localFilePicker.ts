import { isTauri } from '@/core/utils/env';

/** A local audio file resolved to something an `<audio>` element can load. */
export interface PickedFile {
  /** File name including extension, used to derive display metadata. */
  name: string;
  /** Playable URL: an `asset://` URL under Tauri, a blob URL in the browser. */
  url: string;
  /** Absolute path — only known under Tauri. */
  path?: string;
  /** True when `url` is an object URL that must be revoked on dispose. */
  isObjectUrl: boolean;
}

/** Shape returned by the `pick_audio_files` Rust command. */
interface RustPickedFile {
  name: string;
  path: string;
}

/**
 * Ask the user for audio files.
 *
 * Two paths on purpose. Under Tauri the dialog runs in Rust; in a plain browser
 * we fall back to a hidden file input, which is what makes the whole player
 * exercisable with `npm run dev` and no Rust toolchain present.
 */
export async function pickAudioFiles(): Promise<PickedFile[]> {
  return isTauri() ? pickViaTauriDialog() : pickViaFileInput();
}

/**
 * The dialog itself lives in `src-tauri/src/files.rs`, not here.
 *
 * That is a security boundary, not a style choice. Rust opens the picker, so it
 * knows the returned paths came from a real user selection, and grants asset
 * access to exactly those. The static asset scope is empty as a result — this
 * code cannot ask for a path, only receive one.
 */
async function pickViaTauriDialog(): Promise<PickedFile[]> {
  // Imported lazily so the browser bundle never pulls in Tauri code.
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
  const picked = await invoke<RustPickedFile[]>('pick_audio_files');

  return picked.map((file) => ({
    name: file.name,
    url: convertFileSrc(file.path),
    path: file.path,
    isObjectUrl: false,
  }));
}

function pickViaFileInput(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*';
    input.style.display = 'none';

    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      finish(
        files.map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          isObjectUrl: true,
        })),
      );
    });

    // Fires when the native picker is dismissed without a selection. Not
    // supported everywhere, so `finish` guards against a double resolve.
    input.addEventListener('cancel', () => finish([]));

    document.body.appendChild(input);
    input.click();
  });
}
