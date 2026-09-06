//! Moving and resizing the window together.
//!
//! Opening the drawer on the left keeps the window's *right* edge still, so its
//! width and its x change by the same amount and have to agree. Tauri offers
//! `set_position` and `set_size` and nothing that does both, so this does them
//! back to back inside one command — microseconds apart, and well inside the
//! frame the compositor is going to present.
//!
//! It was one `SetWindowPos` before that, which is genuinely atomic and looked
//! like the better answer. It was not: moving the top-level window that way
//! leaves the WebView2 child where it was until Tauri hears about it, and the
//! window blinked out for a frame on every open and close. Going through Tauri
//! means the webview is moved with the window rather than after it.

use tauri::{PhysicalPosition, PhysicalSize, Window};

/// Resize the window and move its left edge by `dx`, in that order.
///
/// `dx` is how far the left edge travels, in logical pixels. Zero is an
/// ordinary resize. Minus the width gained is the drawer opening leftwards: the
/// right edge stays where it is, so the player underneath does not move.
///
/// The frontend supplies the distance rather than this working it out, because
/// the frontend is where the widths come from — it knows what the window is
/// changing from as well as to, and a second opinion here could only disagree.
///
/// Where the window is *now* is read here, which keeps the frontend from
/// needing a position permission it has no other use for.
#[tauri::command]
pub fn set_window_box(window: Window, width: f64, height: f64, dx: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    let px = |v: f64| (v * scale).round() as i32;

    // Size first. Growing to the right briefly covers ground the window is
    // about to occupy anyway; moving first would put it somewhere it never
    // belongs. Neither is normally seen — the webview lays out on the next
    // frame, by which time both have landed.
    window
        .set_size(PhysicalSize::new(
            px(width).max(1) as u32,
            px(height).max(1) as u32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(at.x + px(dx), at.y))
        .map_err(|e| e.to_string())
}

/// Cut the window down to one rectangle, for hit testing as well as for paint.
///
/// The drawer can open to the left without the window ever moving, which is the
/// only arrangement that does not flicker: a window whose origin moves takes its
/// existing pixels with it and the webview lays out again a frame later, so for
/// that frame the shell is drawn where the window used to be. Nothing about the
/// order of the calls fixes that — the lag is inside the webview.
///
/// So on the left the window is simply always as wide as the drawer needs, and
/// the shell grows into it. What that leaves is six hundred and eighty pixels of
/// transparent window beside the player, swallowing clicks meant for whatever is
/// behind it. A window region is the answer to exactly that: outside it the
/// window is not there at all, for the mouse or for the compositor.
///
/// A negative width clears it, which is the whole window again. A zero width is
/// a different thing and a useful one: a window with no shape at all is not on
/// screen, which is how the side swap changes the window's place without
/// anybody watching it happen.
#[tauri::command]
pub fn set_window_mask(
    window: Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let px = |v: f64| (v * scale).round() as i32;
    mask(&window, px(x), px(y), px(width), px(height), px(radius))
}

#[cfg(windows)]
fn mask(
    window: &Window,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    radius: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, CreateRoundRectRgn, SetWindowRgn};

    let handle = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = HWND(handle.0 as *mut _);

    // Safety: the handle belongs to the window this call is about and is alive
    // for its duration. `SetWindowRgn` takes ownership of the region, so the
    // one made here is deliberately not deleted.
    unsafe {
        // Rounded like the shell, and a shade larger than it.
        //
        // Rounded, because a rectangular shape around a rounded window leaves a
        // wedge at each corner where the window is still there and nothing has
        // painted, which Windows fills with a frame of its own — a square
        // corner poking out past the rounded one, repainted in its inactive
        // shade the moment focus goes elsewhere. The left-hand drawer is where
        // it showed, being the one arrangement whose shape has an edge running
        // through the middle of the window rather than along it.
        //
        // Larger, because a region is a one-bit cut: a pixel is in the window
        // or it is not, and a curve made of whole pixels is a staircase. Held
        // a couple of pixels off the shell, the cut lands where the shell has
        // already faded to nothing and what shows is the shell's own corner,
        // drawn with all the smoothing a browser does. Whatever wedge is left
        // is two pixels wide, which is nothing to fill.
        //
        // The ellipse is twice the radius: `CreateRoundRectRgn` takes the width
        // and height of the ellipse its corners are quarters of.
        const SLACK: i32 = 2;
        let region = if width < 0 || height < 0 {
            None
        } else if radius > 0 {
            Some(CreateRoundRectRgn(
                x - SLACK,
                y - SLACK,
                // Exclusive on the far edge, and a round-rect region is a pixel
                // tighter than a rectangular one.
                x + width + SLACK + 1,
                y + height + SLACK + 1,
                (radius + SLACK) * 2,
                (radius + SLACK) * 2,
            ))
        } else {
            Some(CreateRectRgn(x, y, x + width, y + height))
        };
        // Emphatically without a redraw. The region is a clip over a surface
        // the webview has already painted, and everything outside the shell on
        // that surface is transparent — so revealing more of it is nothing but
        // an unclip. Asking Windows to redraw the strip instead makes it paint
        // an area the webview has not composited yet, and that bare frame is
        // the empty window that appeared in the direction the drawer was about
        // to open.
        if SetWindowRgn(hwnd, region, false) == 0 {
            return Err("the window would not take the region".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn mask(
    _window: &Window,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
    _radius: i32,
) -> Result<(), String> {
    // Nothing to do and nothing to fail: the left-hand drawer moves the window
    // on platforms without a window region, which is what the fallback in
    // `place` is for.
    Ok(())
}

/// Take away the frame Windows draws around this window.
///
/// The shell inside is rounded to eighteen pixels and painted by the webview.
/// Windows 11 has its own ideas: a rounded corner of a different radius, and a
/// one-pixel border in the system accent colour. Neither is hidden by the
/// shell, because they are drawn outside it — so what shows is a square-ish
/// corner in somebody's accent colour, poking out past the corner this app
/// drew. Most visibly when focus leaves for another window, because that is
/// when the border is repainted in its inactive shade.
///
/// Both are one call each. A window that draws its whole self, transparency
/// and corners included, is telling the truth by asking for neither.
///
/// Failure is ignored on purpose. These attributes arrived in Windows 11, and
/// on anything older the call is refused — which is the correct outcome there
/// rather than a problem: nothing draws that border on Windows 10 either.
pub fn undress(window: &Window) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
            DWMWCP_DONOTROUND,
        };

        let Ok(handle) = window.hwnd() else { return };
        let hwnd = HWND(handle.0 as *mut _);

        /// `DWMWA_COLOR_NONE`: no border at all, as against a colour to draw it in.
        const NO_BORDER: u32 = 0xFFFF_FFFE;
        let corners = DWMWCP_DONOTROUND;

        // Safety: the handle belongs to the window this is about and is alive
        // for the call; both attributes are the size the API documents for them.
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                std::ptr::from_ref(&NO_BORDER).cast(),
                std::mem::size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                std::ptr::from_ref(&corners).cast(),
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}
