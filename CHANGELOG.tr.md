# Değişiklikler

En yenisi başta. Bu dosya, uygulamanın güncellemeden sonraki ilk açılışta
gösterdiği "Yenilikler" ekranının metnidir: her sürümün başlığı ve özeti, düz
nesir, biçimleme yok. Madde madde kayıt `CHANGELOG.md` içindedir — o dosya aynı
zamanda GitHub sürüm notlarının ve güncelleyicinin gövdesidir, bu yüzden orada
her değişiklik tek tek yazılıdır ve burada yazılmaz.

Başlıklar İngilizcesiyle birebir aynı olmalı; bir testi var.

## 1.0.5 — 2026-09-03

Bir onarım sürümü, ve büyük kısmı kimsenin göremediği bir şekilde bozulmuş bir
şeyle ilgili.

Spotify şubat ayında Web API'sinin büyük bir bölümünü temizledi ve kaldırdığı
uç noktalardan biri, sonsuz çalmanın son çare olarak yaslandığı şeydi: Last.fm'in
hiç duymadığı bir parçadan sonra ne önerileceği. Spotify bu değişikliği daha önce
oluşturulmuş kayıtlar için erteledi, dolayısıyla burada çalışmaya devam etti ama
Groovium'u şubattan sonra kuran herkeste sessizce başarısız oluyordu. O boşluk
kapandı; aynı adım artık aramayla çalışıyor.

Aynı temizliğin diğer yarısı, bir hesabın Premium olup olmadığını söyleyen alanı
kaldırdı. Bunun üzerine kurulu uyarı da herkese çıkmaya başladı — hiç
hedeflemediği Premium hesaplara dahil. O uyarı kalktı. Artık bir Spotify hesabı
bağlıysa Groovium Premium varsayıyor ve sözü çalmanın kendisine bırakıyor.

Spotify kurulum yönergeleri de insanların ihtiyaç duyduğu birkaç şeyi
söylemiyordu; bunlardan biri Spotify'ın kendi formundaki, kaçırıldığında sessizce
başarısız olan bir cevap. Bir de pencerenin çizimine dair beş düzeltme var;
bunlardan biri, açık bir panelin alt kenarında pencereyi boydan boya kesen o
çizgi — panelin yüzeyi artık durmak yerine kabuğun rengine varıyor.

## 1.0.4 — 2026-08-29

Büyük ölçüde 1.0.3'ün iki noktadaki onarımı.

Renkler yeniden senin. O sürüm kontrastı ölçülebilir hâle getirdi, sonra bu
ölçümü senin seçtiğin renkleri değiştirmek için kullandı — ki bir renk
seçicinin varlık sebebinin tam tersidir bu: koyu bir mavi vurgu soluk mavi bir
oynat butonu üretiyordu, açık bir sarı koyu zeytin yeşili bir tane, ve
"okunabilirliği artır"ı açmak vurgu rengini baştan boyuyordu. Seçtiğin iki renk
artık tam olarak seçtiğin gibi kullanılıyor; onlara uyum sağlayan tek şey
üzerlerine çizilen yazı ve ikonlar.

Ve sonsuz çalma sonsuz kalıyor. 1.0.3'te çıkmaz sokakları kapatmak tükenmenin
yeni bir yolunu açmıştı — aynı şarkıya birkaç kez dönmek, önerecek bir şey
bırakmıyordu — ve Last.fm'in tanımadığı parçalarda aramayı gözle görülür ölçüde
yavaşlatmıştı. İkisi de düzeldi, ve artık hiç durmadan beş yüz parça çalan bir
test var.

Ayarlar da toparlandı: Hakkında ait olduğu yere, en alta indi ve güncelleme
denetimi yeni bir şey olmadığında bunu söylüyor. Güncellemeler artık iki uçta da
kendi adına konuşuyor: bekleyen bir sürüm, fark edilmesi gereken bir nokta
olarak kalmak yerine uygulamayı açtığında ne olduğunu ve bir seçeneği önüne
koyuyor; kurulduktan sonraki ilk açılışta da bu ekran neyin değiştiğini
anlatıyor.

## 1.0.3 — 2026-08-28

Bu sürüm özel paletlerle ilgili. Yazılar ve yüzeyler artık karıştırıp ummak
yerine kontrast ölçülerek hesaplanıyor, böylece kendi iki renginden kurulan bir
palet ne seçersen seç okunabilir kalıyor — açık bir yüzey dahil; o durum eskiden
açık zemin üzerine açık yazı üretiyor ve yalnızca bir uyarıyla geçiştiriliyordu.
Ayrıca kontrastı varsayılandan öteye taşıyan bir ayar, ve pencerenin çevresine
vurgu renginde ince bir çerçeve seçeneği var.

## 1.0.2 — 2026-08-26

İnsanların gerçekten karşılaştığı iki arıza. Ağ koptuğunda Spotify plağı
döndürmeye ve ilerleme çubuğunu doldurmaya devam ediyordu, oysa hoparlörden
hiçbir şey çıkmıyordu; bağlantı geri geldiğinde de konum geriye sıçrıyordu.
Kopukluk artık iki saniye kadar içinde fark ediliyor ve müzik görüntüyle
birlikte duruyor, ondan saniyeler sonra değil. Bir de sonsuz çalma aynı şarkıya
her seferinde aynı şarkıyla cevap veriyor, Last.fm'in hiç duymadığı bir parçada
ise büsbütün duruyordu; artık benzerliği ağırlık sayarak rastgele seçiyor ve pes
etmeden önce üç ayrı kaynağa soruyor.
