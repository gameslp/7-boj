# Settebello — 7-bój w Toskanii

Strona do prowadzenia siedmioboju dla dziewięciu osób. Ty prowadzisz rozgrywkę, ekipa
podgląda ją na żywo z telefonów po tym samym WiFi. Bez Dockera, bez hostingu,
bez zależności z npm — Node 24 ma SQLite w środku.

Strona nie jest tylko tablicą wyników: każda dyscyplina ma własną planszę, przy której
się gra. Drabinkę, tabele grup, kolejność strzałów, liczniki do 21, składy z golami
i stół pokerowy. Punkty przeliczają się po każdym meczu, strzale i koszu.

## Odpalenie

```bash
docker compose up -d --build
```

Strona stoi na porcie **3048**. Ty wchodzisz na `http://localhost:3048`, a ekipie
podajesz adres twojego maca w lokalnej sieci:

```bash
echo "http://$(ipconfig getifaddr en0):3048"
```

Musicie być na tym samym WiFi. Adres zmieni się, jeśli router przydzieli macowi inne
IP, więc sprawdź go przed wysłaniem na grupę. Kontener nie widzi adresu hosta, więc
w logu wypisuje podpowiedź zamiast bezużytecznego adresu wewnętrznego Dockera —
możesz mu go podać sam przez `SETTEBELLO_HOST`.

Logi i stan:

```bash
docker compose logs -f
docker compose ps
```

Wyłączenie: `docker compose down`. Wyniki zostają w `./data`, więc następny start
podnosi turniej dokładnie tam, gdzie stanął. Żeby mac nie usnął w połowie pokera,
sprawdź w ustawieniach, czy nie zasypia przy zasilaniu — kontener padnie razem z nim.

### Bez Dockera

Aplikacja nie ma żadnych zależności z npm, więc działa też prosto z Node 24:

```bash
caffeinate -i npm start
```

Wtedy baza siedzi w `settebello.db` w tym katalogu, a serwer sam wypisze adresy
lokalne, bo widzi prawdziwe interfejsy sieciowe.

## Prowadzenie dyscypliny

1. Wejdź na dyscyplinę i ustaw, **kto gra, a kto rezygnuje**.
2. **Otwórz dyscyplinę.** Od tej chwili wszyscy widzą skład i to, że rozstawienia nie
   zna jeszcze nikt.
3. Kliknij **Losuj**. Losowanie wykonuje serwer, więc nikt nie mógł go ustawić
   wcześniej — animacja odpala się na wszystkich telefonach w tej samej sekundzie.
4. Zapisuj na bieżąco. Klasyfikacja przelicza się sama i od razu u wszystkich.

Póki nie ma ani jednego zapisanego wyniku, losowanie można powtórzyć — też na oczach
wszystkich. Po pierwszym wpisie już nie, więc nie ma jak przekręcić rozstawienia
w trakcie.

Co losuje która dyscyplina:

| Dyscyplina | Losowanie | Co zapisujesz |
|---|---|---|
| Tenis | rozstawienie drabinki | punkty tie-breaka do 11 |
| Ping pong | podział na grupy | wyniki setów |
| Łuk | kolejność strzelania | każdy strzał, przyciskami 0–10 |
| Kosz | podział na heaty i kolejność zbiórki | +1, +2 albo 0 przy każdym zawodniku |
| Bule | podział na heaty i kolejność | +1, +2, +3 punkty |
| Water polo | dwóch kapitanów | składy, gole ze strzelcem, MVP |
| Poker | miejsca przy stole | kto wypada |

W koszu każdy ma trzy przyciski: **+1** za rzut ze środka, **+2** za rzut po zbiórce
i **0**, które zabiera mu cały dorobek po pudle w powietrze. Pod tabelką widać
wylosowaną kolejność zbiórki, bo po każdym rzucie zbiera następna osoba z tej listy.

Wszędzie da się cofnąć ostatni wpis, a wyniki meczów poprawić. Zmiana zwycięzcy
półfinału czyści finał, żeby drabinka nie kłamała.

Sama wylosowana dyscyplina jeszcze nie rozdaje punktów — przy zerowych wynikach
kolejność byłaby czystym przypadkiem. Punktacja otwiera się przy pierwszym zapisie.
Na ekranie głównym masz skrót „Teraz gramy" prowadzący prosto na planszę tego, co się
właśnie toczy.

Logowanie zostaje w przeglądarce, ale token unieważnia się przy restarcie serwera,
więc po ponownym `npm start` wpisujesz PIN jeszcze raz.

### Inny PIN, inny port, własny adres

```bash
SETTEBELLO_PIN=twoj-pin docker compose up -d
SETTEBELLO_HOST=192.168.1.80 docker compose up -d
```

Port zmienisz w `docker-compose.yml` w sekcji `ports` — na przykład `'8080:3048'`
wystawi to samo na 8080. Bez Dockera działa `SETTEBELLO_PIN=… PORT=… npm start`.

PIN jest sprawdzany na serwerze, ale to zabezpieczenie na poziomie „nikt z ekipy
nie wpisze sobie punktów przez przypadek", a nie prawdziwa autoryzacja. Trzymaj go
dla siebie i nie wystawiaj serwera do internetu.

## Punktacja

Ta sama skala w każdej dyscyplinie:

| Miejsce | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Punkty | 12 | 10 | 8 | 6 | 5 | 4 | 3 | 2 | 1 |

Water polo jest drużynowe, więc liczy się inaczej: wygrana 9 punktów dla każdego,
przegrana 3, remis 6, MVP dodatkowo +2.

**Rezygnacja to zero punktów.** Bez handicapu i bez przeliczania skali dla tych,
którzy zostali. Punkty są przypisane do miejsca, nie do liczby startujących — kto
wygrywa dyscyplinę, w której gra pięć osób, dostaje te same 12 punktów co zwycięzca
pełnej dziewiątki. To świadoma decyzja: prostsza do wytłumaczenia przy stole i bez
kombinowania, komu się bardziej opłaca nie zagrać.

Kursywa w tabeli oznacza punkty z dyscypliny, która jeszcze trwa — mogą się zmienić.
Kreska to rezygnacja.

Remis w klasyfikacji generalnej rozstrzyga liczba pierwszych miejsc, potem drugich.
Kto nadal jest równy, dzieli miejsce — a na żywo rozstrzygacie jednym strzałem z łuku.

## Zmiany w zasadach i składzie

Wszystko siedzi w [`config.mjs`](config.mjs) — zawodnicy z barwami flag, siedem
dyscyplin z zasadami i parametrami (do ilu gemów, ile serii, do ilu punktów heat),
skala punktowa i liczenie klasyfikacji. Serwer i strona czytają ten jeden plik, więc
nie da się ich rozjechać. Po edycji zrestartuj serwer.

Po zmianach warto puścić testy — przechodzą każdą dyscyplinę od losowania do
rozstrzygnięcia i pilnują punktacji:

```bash
npm test
```

Uwaga: kolejność zawodników w `PLAYERS` to ich identyfikatory w bazie. Dopisanie
kogoś na końcu jest bezpieczne; przestawienie kolejności w środku turnieju przypisze
zapisane wyniki do innych osób.

## Wyniki

W Dockerze baza to `./data/settebello.db` na dysku maca, podmontowana do kontenera.
Przeżywa restart kontenera, przebudowę obrazu i restart maca. Backup przed turniejem
to zwykłe skopiowanie katalogu `data/`. Bez Dockera baza siedzi w `settebello.db`
w katalogu projektu.

Wyczyszczenie całego turnieju wymaga wpisania frazy `Chcę wyczyścić` — sprawdzanej
i w przeglądarce, i na serwerze, żeby nie dało się tego zrobić przez przypadek.

```
config.mjs          zawodnicy, dyscypliny, zasady, punktacja, klasyfikacja
engines.mjs         silniki rozgrywki: drabinka, grupy, strzały, heaty, drużyny, wypadanie
server.mjs          HTTP + SQLite + strumień na żywo (SSE)
test/               testy silników i punktacji
public/index.html   szkielet strony
public/style.css    motyw jasny i ciemny
public/dom.js       flagi zawodników i wspólne klocki interfejsu
public/views.js     plansze siedmiu dyscyplin
public/app.js       routing, klasyfikacja, animacja losowania, panel sędziego
Dockerfile          obraz na Node 24 Alpine, bez instalowania zależności
docker-compose.yml  port 3048, wolumen na wyniki, restart unless-stopped
data/               baza wyników przy uruchomieniu w Dockerze
```

Obraz waży ~56 MB i nie ma w nim warstwy `npm install`, bo aplikacja nie ma
zależności — SQLite jest wbudowany w Node 24. Testy i README nie wchodzą do obrazu.

Serwer jest jedynym autorytetem: przeglądarka wysyła intencje („gol dla Kate”,
„strzał na 9”), silnik przelicza stan i rozsyła gotową planszę wszystkim. Dzięki temu
nikt nie ma u siebie innej wersji wyników.
