import type { en } from './en';

/**
 * Turkish.
 *
 * Typed as a `Partial` of the English dictionary: a missing key falls back to
 * English rather than showing its own name, so a half-finished translation
 * degrades into a mixed window instead of a broken one. `i18n.test.ts` asserts
 * the map is complete, so "degrades gracefully" stays a safety net rather than
 * becoming the normal state.
 *
 * Two things this translation does on purpose. Numbers do not pluralise the
 * noun after them — "3 dosya", not "3 dosyalar" — which is why no `_plural`
 * keys appear here and the singular answers for every count. And the interface
 * addresses the reader with the plural "siz", matching how desktop software is
 * normally worded in Turkish.
 */
export const tr: Partial<Record<keyof typeof en, string>> = {
  'chrome.pin': 'Üstte tut',
  'chrome.unpin': 'Üstte tutmayı bırak',
  'chrome.minimize': 'Küçült',
  'chrome.hide': 'Tepsiye gizle',
  'chrome.collapse': 'Yalnızca kontrolleri göster',
  'chrome.expand': 'Oynatıcının tamamını göster',

  'common.close': 'Kapat',
  'common.cancel': 'Vazgeç',
  'common.save': 'Kaydet',
  'common.saving': 'Kaydediliyor',
  'common.create': 'Oluştur',
  'common.delete': 'Sil',
  'common.back': 'Geri',
  'common.remove': 'Çıkar',
  'common.dismiss': 'Kapat',
  'common.copy': 'Kopyala',
  'common.copied': 'Kopyalandı',
  'common.keep': 'Vazgeç',
  'common.on': 'açık',
  'common.off': 'kapalı',

  'panel.open': '{name} panelini aç',
  'panel.close': '{name} panelini kapat',
  'panel.library': 'Kitaplık',
  'panel.playlists': 'Çalma listeleri',
  'panel.spotify': 'Spotify',
  'panel.settings': 'Ayarlar',

  'transport.shuffle': 'Karıştır',
  'transport.previous': 'Önceki',
  'transport.next': 'Sonraki',
  'transport.play': 'Çal',
  'transport.pause': 'Duraklat',
  'transport.repeat': 'Tekrar: {mode}',
  'transport.station': 'Sonsuz çalma: {state}',
  'transport.seek': 'İleri sar',
  'transport.volume': 'Ses',
  'transport.mute': 'Sesi kapat',
  'transport.unmute': 'Sesi aç',
  'repeat.off': 'kapalı',
  'repeat.one': 'tek şarkı',
  'repeat.all': 'tümü',

  'status.IDLE': 'Hazır',
  'status.LOADING': 'Yükleniyor',
  'status.PLAYING': 'Çalıyor',
  'status.PAUSED': 'Duraklatıldı',
  'status.ERROR': 'Hata',
  'track.none': 'Henüz bir şey çalmıyor',
  'track.hint': 'Başlamak için bir şarkı açın',

  'library.heading': 'Kitaplık · {count}',
  'library.close': 'Kitaplığı kapat',
  'library.addFiles': 'Dosya Ekle',
  'library.addFolder': 'Klasör Ekle',
  'library.empty':
    'Burada henüz bir şey yok. Başlamak için müzik ekleyin — şarkılar kopyalanarak alınır, böylece aslını taşısanız veya silseniz de çalmaya devam eder.',
  'library.confirmImport': '{count} dosya ({size}) kitaplığınıza kopyalansın mı?',
  'library.duplicates': '{count} tanesi zaten ekli.',
  'library.removeNamed': '{title} şarkısını kitaplıktan çıkar',
  'library.removeTitle': 'Kitaplıktan çıkar',
  'library.confirmRemove':
    'Bu şarkı kitaplığınızdan silinsin mi? Uygulamanın tuttuğu kopya kalıcı olarak kaldırılır.',
  'library.importing': '{total} şarkıdan {done}. ekleniyor',
  'library.cancelImport': 'Eklemeyi iptal et',

  'playlists.close': 'Çalma listelerini kapat',
  'playlists.emptyPlaylist':
    'Burada henüz bir şey yok. Kitaplığınızdan veya Spotify’dan şarkı ekleyin.',
  'playlists.none': 'Henüz çalma listesi yok. Şarkıları bir arada tutmak için bir tane oluşturun.',
  'playlists.newPlaceholder': 'Yeni çalma listesi',
  'playlists.unavailable': 'Bulunamadı',
  'playlists.removedFromLibrary': 'Kitaplıktan çıkarıldı',
  'playlists.removeItem': 'Çalma listesinden çıkar',
  'playlists.deleteNamed': '{name} listesini sil',
  'playlists.deleteTitle': 'Çalma listesini sil',
  'playlists.add': 'Çalma listesine ekle',
  'playlists.addNamed': '{title} şarkısını bir çalma listesine ekle',
  'playlists.pickerNone': 'Henüz çalma listesi yok — aşağıda bir tane adlandırın.',
  'playlists.added': 'Ekli',

  'spotify.heading': 'Spotify · {name}',
  'spotify.signOut': 'Çıkış yap',
  'spotify.close': 'Spotify panelini kapat',
  'spotify.checking': 'Spotify kurulumunuz denetleniyor…',
  'spotify.waiting': 'Tarayıcınızda izin vermeniz bekleniyor…',
  'spotify.waitingHint': 'İsteği onaylayın, sonra buraya dönün.',
  'spotify.savedId':
    'Client ID’niz kayıtlı. Çalmaya başlamak için Spotify hesabınızı bağlayın.',
  'spotify.connect': 'Spotify Hesabını Bağla',
  'spotify.changeId': 'Başka bir Client ID kullan',
  'spotify.searchPlaceholder': 'Spotify’da şarkı ara',
  'spotify.searching': 'Aranıyor…',
  'spotify.nothingFound': 'Bir şey bulunamadı.',
  'spotify.typeToFind': 'Şarkı bulmak için yazın.',

  'setup.optionalLead': 'Spotify isteğe bağlı.',
  'setup.optionalRest':
    'Kendi müziğiniz bunların hiçbiri olmadan çalar — yalnızca buradan Spotify’da arama yapmak istiyorsanız kurun.',
  'setup.oneTime':
    'Spotify her kurulumun kendi uygulamasını kaydetmesini ister. Bu tek seferlik bir işlemdir.',
  'setup.step1': 'Bir uygulama oluşturun',
  'setup.step1Body': 'Herhangi bir ad ve açıklama olur.',
  // Rendered inside a `lang="en"` button, because uppercasing "Spotify" under
  // Turkish rules gives "SPOTİFY". That means no Turkish ı/i may appear here
  // either — it would capitalise by English rules and come out wrong.
  'setup.openDashboard': 'Spotify Dashboard’u aç ↗',
  'setup.step2': 'Bu yönlendirme adresini ekleyin',
  'setup.step2Body': 'Sonunda eğik çizgi olmadan, birebir aynı olmalı.',
  'setup.step3': 'Kendinizi kullanıcı olarak ekleyin',
  'setup.step3Body':
    'Uygulamanın User Management sekmesini açıp kendi Spotify hesabınızı ekleyin. Bunu yapmazsanız Spotify girişi reddeder.',
  'setup.step4': 'Client ID’nizi yapıştırın',
  'setup.idPlaceholder': '32 karakterlik Client ID',
  'setup.premium': 'Çalmak için Spotify Premium gerekir.',
  'setup.clipboardFailed': 'Panoya erişilemedi. Adresi seçip elle kopyalayın.',

  'station.heading': 'Sonsuz çalma',
  'station.dialog': 'Sonsuz çalmayı kur',
  'station.intro':
    'Çalma listesi bittiğinde, o an çalan şarkıya benzeyen bir şarkı bulup müziği sürdürür. Öneriler Last.fm’den gelir ve ücretsiz bir API anahtarı gerektirir.',
  'station.optional': 'Tamamen isteğe bağlı — geri kalan her şey onsuz da çalışır.',
  'station.step1': 'Bir API hesabı oluşturun',
  'station.formIntro': 'Formda dört alan var. Yalnızca ilk ikisi önemli:',
  'station.fieldName': 'Application name',
  'station.fieldNameValue': 'ne olursa — “Groovium” iş görür',
  'station.fieldDescription': 'Application description',
  'station.fieldDescriptionValue': 'ne olursa',
  'station.fieldHomepage': 'Application homepage',
  'station.fieldCallback': 'Callback URL',
  'station.fieldBlank': 'boş bırakın',
  'station.callbackNote':
    'Son ikisi Last.fm’in oturum açma akışına ait. Groovium sizi hiçbir zaman oturum açtırmaz — yalnızca hangi şarkıların benzer olduğunu sorar, bunun için de anahtar yeter.',
  'station.openLastfm': 'Last.fm’i aç ↗',
  'station.step2': 'Buraya yapıştırın',
  'station.keyPlaceholder': '32 karakterlik API anahtarı',
  'station.footnote':
    'Anahtar hemen çıkar — onaylanacak bir şey, bağlanacak bir hesap yok. Kitaplığınızdaki şarkılar öncelikli seçilir, bu yüzden sonsuz çalma genellikle hiçbir maliyet çıkarmadan sürer.',

  'settings.close': 'Ayarları kapat',
  'settings.appearance': 'Görünüm',
  'settings.theme': 'Tema',
  'settings.custom': 'Özel',
  'settings.customPrimary': 'Yüzey',
  'settings.customSecondary': 'Vurgu',
  'settings.customWarning':
    'Özel renk kombinasyonlarında kontrast oranları garanti edilemez. Ön tanımlı paletlerin tamamı optimum okunabilirlik için kalibre edilmiştir.',
  'settings.language': 'Dil',
  'settings.behaviour': 'Davranış',
  'settings.reduceMotion': 'Hareketi azalt',
  'settings.reduceMotionHint': 'Plağın dönmesini ve diskin uçuşunu durdurur.',
  'settings.alwaysOnTop': 'Pencereyi üstte tut',
  'settings.alwaysOnTopHint': 'Diğer pencerelerin üstünde kalır ve hatırlanır.',
  'settings.connections': 'Bağlantılar',
  'settings.configured': 'Kurulu',
  'settings.notConfigured': 'Kurulu değil',
  'settings.setUp': 'Kur',
  'settings.forget': 'Unut',
  'settings.spotifyHint': 'Spotify’dan arayıp çalın.',
  'settings.lastfmHint': 'Sonsuz çalma için sonraki şarkıyı bulur.',

  'tray.show': 'Groovium’u göster',
  'tray.previous': 'Önceki',
  'tray.playPause': 'Çal / Duraklat',
  'tray.next': 'Sonraki',
  'tray.quit': 'Groovium’dan çık',

  'error.settingsNotSaved':
    'Ayarlar kaydedilmiyor — ses düzeyi ve tekrar, yeniden başlatınca sıfırlanacak.',
  'error.spotifyDisconnected':
    'Bağlantı kesildiği için çalma durduruldu. Dinlemeye devam etmek için hesabınızı bağlayın.',
  'error.notPlayable': 'Bu şarkı bir çalma listesine kaydedilemez.',
  'error.startup': 'Başlatılamadı: {message}',
  'error.providerUnavailable': '{provider} kullanılamıyor.',
};
