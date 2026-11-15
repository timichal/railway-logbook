import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { romanizeCyrillic, romanizeName } from "@/scripts/lib/cyrillicRomanization";

describe("romanizeCyrillic", () => {
  test("Bulgaria: the Streamlined System, ъ a full vowel", () => {
    assert.equal(romanizeCyrillic("Дъбово", "BG"), "Dabovo");
    assert.equal(romanizeCyrillic("Горна Оряховица", "BG"), "Gorna Oryahovitsa");
    assert.equal(romanizeCyrillic("Щърково", "BG"), "Shtarkovo");
    assert.equal(romanizeCyrillic("Шумен", "BG"), "Shumen");
    assert.equal(romanizeCyrillic("Юруково", "BG"), "Yurukovo");
    assert.equal(romanizeCyrillic("Калища", "BG"), "Kalishta");
  });

  test("Bulgaria: -ия ends a word as ia, nowhere else", () => {
    assert.equal(romanizeCyrillic("Централна гара София", "BG"), "Tsentralna gara Sofia");
    assert.equal(romanizeCyrillic("Провадия", "BG"), "Provadia");
    assert.equal(romanizeCyrillic("Мизия-спирка", "BG"), "Mizia-spirka");
    assert.equal(romanizeCyrillic("Ияново", "BG"), "Iyanovo");
  });

  test("a capital spelt with two letters is capitalized, or all capitals in a capital word", () => {
    assert.equal(romanizeCyrillic("Жолио Кюри", "BG"), "Zholio Kyuri");
    assert.equal(romanizeCyrillic("ЖП ГАРА", "BG"), "ZHP GARA");
    assert.equal(romanizeCyrillic("Ж", "BG"), "Zh");
    assert.equal(romanizeCyrillic("Љубовија", "RS"), "Ljubovija");
    assert.equal(romanizeCyrillic("ЉИГ", "RS"), "LJIG");
  });

  test("Serbian-writing countries: Gaj's Latin alphabet", () => {
    assert.equal(romanizeCyrillic("Ниш", "RS"), "Niš");
    assert.equal(romanizeCyrillic("Ћуприја", "RS"), "Ćuprija");
    assert.equal(romanizeCyrillic("Ђевђелија", "RS"), "Đevđelija");
    assert.equal(romanizeCyrillic("Београд Центар", "RS"), "Beograd Centar");
    assert.equal(romanizeCyrillic("Џеп", "RS"), "Džep");
    assert.equal(romanizeCyrillic("Осипаоница стајалиште", "RS"), "Osipaonica stajalište");
    assert.equal(romanizeCyrillic("Никшић", "ME"), "Nikšić");
    assert.equal(romanizeCyrillic("Добој", "BA"), "Doboj");
  });

  test("North Macedonia: the local Latin alphabet, gj and kj for ѓ and ќ", () => {
    assert.equal(romanizeCyrillic("Ѓорче Петров", "MK"), "Gjorče Petrov");
    assert.equal(romanizeCyrillic("Кичево", "MK"), "Kičevo");
    assert.equal(romanizeCyrillic("Штип", "MK"), "Štip");
    assert.equal(romanizeCyrillic("Згрополци", "MK"), "Zgropolci");
    assert.equal(romanizeCyrillic("Ќафа", "MK"), "Kjafa");
    assert.equal(romanizeCyrillic("Ѕвезда", "MK"), "Dzvezda");
    assert.equal(romanizeCyrillic("Маџари", "MK"), "Madžari");
  });

  test("Ukraine: the national system, y at the start of a word and i inside one", () => {
    assert.equal(romanizeCyrillic("Київ", "UA"), "Kyiv");
    assert.equal(romanizeCyrillic("Львів", "UA"), "Lviv");
    assert.equal(romanizeCyrillic("Харків", "UA"), "Kharkiv");
    assert.equal(romanizeCyrillic("Запоріжжя", "UA"), "Zaporizhzhia");
    assert.equal(romanizeCyrillic("Яблунька", "UA"), "Yablunka");
    assert.equal(romanizeCyrillic("Старий Самбір", "UA"), "Staryi Sambir");
    assert.equal(romanizeCyrillic("Йосипівка", "UA"), "Yosypivka");
    assert.equal(romanizeCyrillic("Ґалаґанівка", "UA"), "Galaganivka");
    assert.equal(romanizeCyrillic("Згурівка", "UA"), "Zghurivka");
    assert.equal(romanizeCyrillic("Мостиська ІІ", "UA"), "Mostyska II");
  });

  test("Ukraine: an apostrophe is dropped, and the letter after it is not word-initial", () => {
    assert.equal(romanizeCyrillic("Знам'янка", "UA"), "Znamianka");
    assert.equal(romanizeCyrillic("Мар’їне", "UA"), "Marine");
    assert.equal(romanizeCyrillic("Кам'янське-Пасажирське", "UA"), "Kamianske-Pasazhyrske");
  });

  test("Belarus: the national system, je after a vowel or separator, ie after a consonant", () => {
    assert.equal(romanizeCyrillic("Магілёў", "BY"), "Mahilioŭ");
    assert.equal(romanizeCyrillic("Гомель", "BY"), "Homieĺ");
    assert.equal(romanizeCyrillic("Віцебск", "BY"), "Viciebsk");
    assert.equal(romanizeCyrillic("Ельск", "BY"), "Jeĺsk");
    assert.equal(romanizeCyrillic("Зялёнае", "BY"), "Zialionaje");
    assert.equal(romanizeCyrillic("Зашчобʼе", "BY"), "Zaščobje");
    assert.equal(romanizeCyrillic("Маладзечна", "BY"), "Maladziečna");
    assert.equal(romanizeCyrillic("Смаргонь", "BY"), "Smarhoń");
    assert.equal(romanizeCyrillic("Брэст-Цэнтральны", "BY"), "Brest-Centraĺny");
  });

  test("Russia: simplified BGN/PCGN", () => {
    assert.equal(romanizeCyrillic("Голицыно", "RU"), "Golitsyno");
    assert.equal(romanizeCyrillic("Храпуново", "RU"), "Khrapunovo");
    assert.equal(romanizeCyrillic("Шереметьевская", "RU"), "Sheremetyevskaya");
    assert.equal(romanizeCyrillic("Площадь Ильича", "RU"), "Ploshchad Ilyicha");
    assert.equal(romanizeCyrillic("Балтийская", "RU"), "Baltiyskaya");
    assert.equal(romanizeCyrillic("Охотный ряд", "RU"), "Okhotny ryad");
    assert.equal(romanizeCyrillic("Волгоградский проспект", "RU"), "Volgogradsky prospekt");
    assert.equal(romanizeCyrillic("Новые Черёмушки", "RU"), "Novye Cheryomushki");
    assert.equal(romanizeCyrillic("Чёрное", "RU"), "Chyornoye");
    assert.equal(romanizeCyrillic("Ерино", "RU"), "Yerino");
    assert.equal(romanizeCyrillic("Подъезд", "RU"), "Podyezd");
  });

  test("a stress mark is dropped", () => {
    assert.equal(romanizeCyrillic("Чугу́їв", "UA"), "Chuhuiv");
    assert.equal(romanizeCyrillic("Москва́", "RU"), "Moskva");
  });

  test("a name in another language than its country's goes by the language", () => {
    // ы is not Ukrainian: a Russian name, romanized as Russian.
    assert.equal(romanizeCyrillic("Красный Лиман", "UA"), "Krasny Liman");
    // и and щ are not Belarusian.
    assert.equal(romanizeCyrillic("Минск-Пассажирский", "BY"), "Minsk-Passazhirsky");
    assert.equal(romanizeCyrillic("Щука", "RS"), "Shchuka");
  });

  test("anywhere else, Russian", () => {
    assert.equal(romanizeCyrillic("Тирасполь", "MD"), "Tiraspol");
    assert.equal(romanizeCyrillic("Москва", null), "Moskva");
  });

  test("Latin passes through", () => {
    assert.equal(romanizeCyrillic("Niš", "RS"), "Niš");
    assert.equal(romanizeCyrillic("Sofia 2", "BG"), "Sofia 2");
  });

  test("a letter no system covers is romanized alone, keeping every other diacritic", () => {
    assert.equal(romanizeCyrillic("Мінск ўщ", "BY"), "Minsk ŭshch");
    assert.equal(romanizeCyrillic("Ниш Žiča", "RS"), "Niš Žiča");
  });

  test("a decomposed letter romanizes as the composed one", () => {
    assert.equal(romanizeCyrillic("Київ".normalize("NFD"), "UA"), "Kyiv");
    assert.equal(romanizeCyrillic("Чёрное".normalize("NFD"), "RU"), "Chyornoye");
    assert.equal(romanizeCyrillic("Магілёў".normalize("NFD"), "BY"), "Mahilioŭ");
  });

  test("a grave stress mark is dropped, but ѐ and ѝ stay letters", () => {
    assert.equal(romanizeCyrillic("Москва̀", "RU"), "Moskva");
    assert.equal(romanizeCyrillic("Ѝ", "BG"), "I");
    assert.equal(romanizeCyrillic("ѝ", "BG"), "i");
  });

  test("an apostrophe between letters is dropped, a quote is not", () => {
    assert.equal(romanizeCyrillic("Зупинка ’Київ’", "UA"), "Zupynka ’Kyiv’");
    assert.equal(romanizeCyrillic("Ко'", "BY"), "Ko'");
  });

  test("a two-letter match takes its case from the letter after it", () => {
    assert.equal(romanizeCyrillic("СОФИЯ", "BG"), "SOFIA");
    assert.equal(romanizeCyrillic("ЗГУРІВКА", "UA"), "ZGHURIVKA");
    assert.equal(romanizeCyrillic("Згурівка", "UA"), "Zghurivka");
  });
});

describe("romanizeName", () => {
  const nowhere = () => null;

  test("Greek in a Cyrillic name is romanized too", () => {
    assert.equal(
      romanizeName("Ελληνικό Москва", () => "RU"),
      "Elliniko Moskva",
    );
  });

  test("Greek alone goes to the package, Latin passes through untouched", () => {
    assert.equal(romanizeName("Θεσσαλονίκη", nowhere), "Thessaloniki");
    assert.equal(romanizeName("Kadaň-Prunéřov", nowhere), "Kadaň-Prunéřov");
  });

  test("the country is looked up only for a Cyrillic name", () => {
    let asked = 0;
    const country = () => {
      asked++;
      return "BG";
    };
    romanizeName("Praha hl.n.", country);
    romanizeName("Θεσσαλονίκη", country);
    assert.equal(asked, 0);
    assert.equal(romanizeName("Дъбово", country), "Dabovo");
    assert.equal(asked, 1);
  });
});
