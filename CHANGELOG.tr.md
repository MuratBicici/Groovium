# Değişiklikler

En yenisi başta. Bu dosya, uygulamanın güncellemeden sonraki ilk açılışta
gösterdiği "Yenilikler" ekranının metnidir: her sürümün başlığı ve özeti, düz
nesir, biçimleme yok. Madde madde kayıt `CHANGELOG.md` içindedir — o dosya aynı
zamanda GitHub sürüm notlarının ve güncelleyicinin gövdesidir, bu yüzden orada
her değişiklik tek tek yazılıdır ve burada yazılmaz.

Başlıklar İngilizcesiyle birebir aynı olmalı; bir testi var.

Bu bir çeviri değil, Türkçe bir metin. İngilizcesi uzun cümleler ve araya
sıkıştırılmış yan cümlelerle yazılıyor; Türkçede aynı yapı, yüklemi sayfanın
sonunda bekleyen bir cümle demek. Kısa cümle kurun, yüklemi geciktirmeyin,
"siz" diye hitap edin — arayüzün tamamı öyle yapıyor.

## 1.0.5 — 2026-09-03

Bir onarım sürümü. Büyük kısmı, kimsenin fark edemeyeceği şekilde bozulan bir
şeyle ilgili.

Spotify şubatta Web API'sinin büyük bir bölümünü kaldırdı. Gidenlerden biri,
sonsuz çalmanın son çaresiydi: Last.fm'in hiç duymadığı bir parçadan sonra ne
önerileceğini o söylüyordu. Spotify bu değişikliği eski kayıtlar için erteledi.
Yani burada çalışmaya devam etti, ama Groovium'u şubattan sonra kuran herkeste
sessizce bozuldu. O adım artık aramayla yürüyor.

Aynı temizlik, bir hesabın Premium olup olmadığını söyleyen alanı da kaldırdı.
Alan boş gelince, ona bakan uyarı herkese çıkmaya başladı — Premium
kullananlara bile. Uyarı tamamen kalktı. Bir Spotify hesabı bağlıysa Groovium
artık Premium varsayıyor; gerisini çalmanın kendisi gösteriyor.

Spotify kurulum adımları da eksikti. Biri şu: Spotify'ın kendi formunda bir
seçeneği işaretlemezseniz hata almıyorsunuz, ama hiçbir şey de çalmıyor. Bir de
pencerenin çiziminde beş düzeltme var. Bunlardan biri, açık bir panelin alt
kenarında pencereyi boydan boya kesen çizgiydi.

## 1.0.4 — 2026-08-29

Çoğunlukla 1.0.3'ün iki noktadan onarımı.

Renkler yeniden sizin. O sürüm kontrastı ölçülebilir hâle getirdi, sonra da bu
ölçüyle sizin seçtiğiniz rengi değiştirmeye başladı. Bir renk seçicinin tam
tersi: koyu mavi bir vurgudan soluk mavi bir oynat butonu çıkıyordu, açık
sarıdan koyu zeytin yeşili bir tane. "Okunabilirliği artır" seçeneği de vurgu
rengini baştan boyuyordu. Seçtiğiniz iki renk artık aynen kullanılıyor. Onlara
uyum sağlayan tek şey, üzerlerine çizilen yazı ve simgeler.

Sonsuz çalma da gerçekten sonsuz. 1.0.3 çıkmaz sokakları kapatırken tükenmenin
yeni bir yolunu açmıştı: aynı şarkıya birkaç kez dönünce önerecek bir şey
kalmıyordu. Last.fm'in tanımadığı parçalarda da arama gözle görülür şekilde
yavaşlamıştı. İkisi de düzeldi. Artık hiç durmadan beş yüz parça çalan bir test
var.

Ayarlar da toparlandı. Hakkında bölümü en alta, ait olduğu yere indi. Güncelleme
denetimi, yeni bir şey yoksa bunu söylüyor. Güncellemeler de artık iki uçta da
kendini anlatıyor: bekleyen bir sürüm varsa uygulamayı açtığınızda ne olduğunu
ve seçeneklerinizi önünüze koyuyor, fark etmeniz gereken bir noktaya
dönüşmüyor. Kurulumdan sonraki ilk açılışta da neyin değiştiğini anlatıyor.

## 1.0.3 — 2026-08-28

Bu sürüm özel paletlerle ilgili. Yazı ve yüzey renkleri artık karıştırıp umarak
değil, kontrast ölçülerek bulunuyor. Böylece kendi iki renginizden kurulan bir
palet ne seçerseniz seçin okunabilir kalıyor — açık bir yüzey seçseniz bile.
Eskiden o durum açık zemin üzerine açık yazı üretiyor, sonra da bir uyarıyla
geçiştiriliyordu. Ayrıca kontrastı varsayılanın ötesine taşıyan bir ayar var, ve
pencerenin çevresine vurgu renginizde ince bir çerçeve ekleyebiliyorsunuz.

## 1.0.2 — 2026-08-26

İnsanların gerçekten karşılaştığı iki arıza.

Ağ koptuğunda Spotify plağı döndürmeye ve ilerleme çubuğunu doldurmaya devam
ediyordu, oysa hoparlörden ses gelmiyordu. Bağlantı geri gelince de konum
geriye sıçrıyordu. Kopukluk artık iki saniye kadar içinde fark ediliyor; müzik
görüntüyle birlikte duruyor, ondan saniyeler sonra değil.

Sonsuz çalma da aynı şarkıya her seferinde aynı şarkıyla cevap veriyordu.
Last.fm'in hiç duymadığı bir parçada ise büsbütün duruyordu. Artık benzerliği
ağırlık sayarak rastgele seçiyor ve pes etmeden önce üç ayrı kaynağa soruyor.
