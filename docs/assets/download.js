// Point the download buttons straight at the latest installer.
//
// The installer's name carries its version (Groovium_1.2.1_x64-setup.exe), so
// there is no fixed address for "the newest .exe" to write into the page. The
// buttons are written pointing at the latest release's page, which always
// works; this asks GitHub which file that release has and, if it answers,
// swaps each button over to the file itself. No answer — offline, rate limited,
// a release without an installer — leaves the buttons where they were.
(function () {
  var buttons = document.querySelectorAll('a[data-download]');
  if (!buttons.length || !window.fetch) return;

  fetch('https://api.github.com/repos/MuratBicici/Groovium/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (release) {
      if (!release || !release.assets) return;
      var installer = null;
      for (var i = 0; i < release.assets.length; i++) {
        var asset = release.assets[i];
        if (/-setup\.exe$/i.test(asset.name)) {
          installer = asset;
          break;
        }
      }
      if (!installer) return;
      var version = String(release.tag_name || '').replace(/^v/, '');
      for (var j = 0; j < buttons.length; j++) {
        buttons[j].href = installer.browser_download_url;
        if (version) buttons[j].title = 'Groovium ' + version;
      }
    })
    .catch(function () {
      /* the release page is still a good place to land */
    });
})();
