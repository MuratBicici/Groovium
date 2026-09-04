//! Per-process loopback capture, in raw Win32.
//!
//! `cpal` cannot do this: its Windows backend asks the device enumerator for a
//! render endpoint and sets the loopback flag on it, which is the whole machine.
//! Narrowing it to one process tree goes through a different door —
//! `ActivateAudioInterfaceAsync` against a virtual device, with the target
//! process id passed in the activation parameters — and that door is only open
//! to the raw interface.
//!
//! Everything here is `unsafe` because all of it is COM. The parts that are not
//! obvious are commented; the parts that are simply Win32 ceremony are not.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, Result as WinResult, PCWSTR};
use windows::Win32::Foundation::S_OK;
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::Variant::VT_BLOB;

use super::Probe;

/// The virtual device that stands in for "a process rather than a sound card".
const PROCESS_LOOPBACK_DEVICE: PCWSTR = windows::core::w!("VAD\\Process_Loopback");

/// `WAVE_FORMAT_IEEE_FLOAT`. Written out rather than imported: it lives in the
/// `Win32_Media_Multimedia` feature, and pulling a whole feature in for one
/// integer that has been 3 since 1995 is not a trade worth making.
const FLOAT_SAMPLES: u16 = 3;

/// What the capture is asked to produce. A process loopback client has no mix
/// format of its own to inherit — there is no device behind it — so one has to
/// be named, and Windows converts into it.
const RATE: u32 = 48_000;
const CHANNELS: u16 = 2;

/// Somewhere for the completion handler to leave its answer.
///
/// `ActivateAudioInterfaceAsync` is asynchronous even though nothing about this
/// wants to be: the interface arrives on another thread, through a COM object
/// this has to implement, and the only thing that object does is say "here".
#[derive(Default)]
struct Arrival {
    done: Mutex<bool>,
    woken: Condvar,
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Handler(Arc<Arrival>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Handler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> WinResult<()> {
        let mut done = self.0.done.lock().unwrap_or_else(|e| e.into_inner());
        *done = true;
        self.0.woken.notify_all();
        Ok(())
    }
}

/// Listen for `millis` and report the loudest thing heard.
///
/// `ours` picks which side of this app the listening is done on: its own
/// process tree, or everything except it. The second is only ever a question —
/// it is the whole machine minus us, which is not something to ship — but it is
/// the one measurement that can tell "our tree renders no audio" apart from
/// "process loopback delivers no audio here", and those need different answers.
pub fn listen(millis: u64, ours: bool) -> Result<Probe, String> {
    unsafe {
        // Ignored on purpose: a failure here is almost always "already
        // initialised on this thread with a different model", which is fine —
        // Tauri's command threads may well have done it.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: GetCurrentProcessId(),
                    // The tree, not the process. The audio being asked about is
                    // rendered by WebView2, which runs in children of this
                    // process; asking only about this one would capture the
                    // local player and nothing else.
                    ProcessLoopbackMode: if ours {
                        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                    } else {
                        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                    },
                },
            },
        };

        // The parameters travel as a blob in a PROPVARIANT, which is the shape
        // this call takes them in. Built by hand because the safe wrapper has
        // no constructor for a blob.
        let mut variant = PROPVARIANT::default();
        {
            let raw = &mut *(&mut variant as *mut PROPVARIANT).cast::<RawPropVariant>();
            raw.vt = VT_BLOB.0;
            raw.blob.size = std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32;
            raw.blob.data = (&mut params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast();
        }

        let arrival = Arc::new(Arrival::default());
        let handler: IActivateAudioInterfaceCompletionHandler = Handler(arrival.clone()).into();

        let operation: IActivateAudioInterfaceAsyncOperation = ActivateAudioInterfaceAsync(
            PROCESS_LOOPBACK_DEVICE,
            &IAudioClient::IID,
            Some(&variant),
            &handler,
        )
        .map_err(|e| format!("could not ask for this app's audio: {e}"))?;

        // Wait for the handler above. A second is a very long time for this;
        // the timeout exists so a machine where it never completes says so
        // rather than hanging a command.
        {
            let mut done = arrival.done.lock().map_err(|_| "activation lock poisoned")?;
            while !*done {
                let (guard, timeout) = arrival
                    .woken
                    .wait_timeout(done, Duration::from_secs(2))
                    .map_err(|_| "activation lock poisoned")?;
                done = guard;
                if timeout.timed_out() && !*done {
                    return Err("the audio interface never arrived".into());
                }
            }
        }

        let mut activation = S_OK;
        let mut interface = None;
        operation
            .GetActivateResult(&mut activation, &mut interface)
            .map_err(|e| format!("activation failed: {e}"))?;
        activation.ok().map_err(|e| {
            format!("this Windows will not hand over one app's audio: {e}")
        })?;
        let client: IAudioClient = interface
            .ok_or_else(|| "activation returned nothing".to_string())?
            .cast()
            .map_err(|e| format!("not an audio client: {e}"))?;

        // 32-bit float, because that is what the spectrum wants and Windows
        // will convert into it.
        let format = WAVEFORMATEX {
            wFormatTag: FLOAT_SAMPLES,
            nChannels: CHANNELS,
            nSamplesPerSec: RATE,
            wBitsPerSample: 32,
            nBlockAlign: CHANNELS * 4,
            nAvgBytesPerSec: RATE * CHANNELS as u32 * 4,
            cbSize: 0,
        };

        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                // A second of buffer, in hundred-nanosecond units. A process
                // loopback client is not driven by a device clock, so this is
                // simply how much may pile up before anything is read.
                10_000_000,
                0,
                &format,
                None,
            )
            .map_err(|e| format!("could not start listening to this app: {e}"))?;

        let capture: IAudioCaptureClient =
            client.GetService().map_err(|e| format!("no capture service: {e}"))?;
        client.Start().map_err(|e| format!("could not start: {e}"))?;

        let mut probe = Probe { sample_rate: RATE, channels: CHANNELS, ..Probe::default() };
        let until = Instant::now() + Duration::from_millis(millis);
        while Instant::now() < until {
            let Ok(available) = capture.GetNextPacketSize() else {
                break;
            };
            if available == 0 {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }

            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            if capture
                .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                .is_err()
            {
                break;
            }
            probe.captured = true;
            probe.frames += u64::from(frames);
            probe.packets += 1;
            // `AUDCLNT_BUFFERFLAGS_SILENT`. Windows sets it when it knows there
            // was nothing to put in the buffer, which is a different statement
            // from a buffer that happens to hold zeros: the first says nobody
            // is rendering into this stream, the second says they are and it is
            // quiet. Those want different answers, so they are counted apart.
            if flags & 0x2 != 0 {
                probe.silent_packets += 1;
            }
            if !data.is_null() && frames > 0 {
                let samples = std::slice::from_raw_parts(
                    data.cast::<f32>(),
                    frames as usize * CHANNELS as usize,
                );
                for &sample in samples {
                    let level = sample.abs();
                    if level > probe.peak {
                        probe.peak = level;
                    }
                }
            }
            let _ = capture.ReleaseBuffer(frames);
        }

        let _ = client.Stop();
        // Leaked on purpose, and it leaks nothing. The blob inside this variant
        // points at `params`, which is on this stack; dropping it would hand
        // that address to the COM allocator to free, which is a stack pointer
        // being passed to `CoTaskMemFree`.
        std::mem::forget(variant);

        Ok(probe)
    }
}

/// The layout of a `PROPVARIANT` holding a blob.
///
/// The safe type has no way to build one, and this is the shape the audio
/// activation call documents. Only the first union arm is ever touched.
#[repr(C)]
struct RawPropVariant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    blob: RawBlob,
}

#[repr(C)]
struct RawBlob {
    size: u32,
    data: *mut u8,
}

/// The cast above is only sound if the two are the same size, and a mistake
/// there would be silent — a `PROPVARIANT` written through a bigger view of
/// itself scribbles past its own end. The compiler checks it instead.
const _: () = assert!(
    std::mem::size_of::<RawPropVariant>() == std::mem::size_of::<PROPVARIANT>(),
    "the hand-written PROPVARIANT no longer matches the real one",
);
