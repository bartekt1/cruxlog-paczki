# Paczki skał Cruxlog

Paczki skał i dróg do pobrania w aplikacji Cruxlog (Ustawienia › Paczki skał). Wszystkie dane są własne, zebrane w terenie, bez treści z przewodników i serwisów.

## Jak to działa

- `baza/` – baza skał w plikach CSV we wzorze Cruxlog (jeden wiersz = jedna droga; opis kolumn: `docs/IMPORT.md` w repozytorium aplikacji). Może być jeden plik albo kilka, wszystkie z tymi samymi kolumnami.
- `paczki/` – paczki zbudowane automatycznie: **jedna paczka = jedna grupa skał** (pierwszy poziom kolumny Grupa, np. Kamieniec). Skały bez grupy trafiają do paczki „<Rejon> – pozostałe skały”.
- `index.json` – spis paczek, który czyta aplikacja: nazwa, region, rejon, liczba skał i dróg, wersja, rozmiar, obszar na mapie.

Nie edytuj ręcznie `paczki/` ani `index.json`: po każdej zmianie w `baza/` GitHub sam je przebuduje (zakładka Actions › „Zbuduj paczki”, około minuty).

## Dodanie albo poprawienie skał

1. Popraw plik w `baza/` (na GitHubie: otwórz plik › ołówek albo „Add file › Upload files”, aby wgrać nową wersję) i zatwierdź zmianę.
2. Poczekaj, aż „Zbuduj paczki” w zakładce Actions zakończy się na zielono.
3. W aplikacji paczki, które się zmieniły, pokażą „Dostępna aktualizacja”.

Zasady:
- Jedna skała należy do jednej grupy (nie dziel dróg jednej skały między grupy).
- Wypełniaj **ID_skały** i **ID_drogi** (np. `sk-0001`, `dr-0001`) i nie zmieniaj ich później: po nich aplikacja rozpoznaje skały i drogi przy aktualizacji i zachowuje przejścia użytkowników, także po zmianie nazwy.
- Wersja paczki rośnie sama, tylko gdy jej zawartość się zmieniła.

Gdy coś jest nie tak (np. skała w dwóch grupach), „Zbuduj paczki” kończy się na czerwono, a w jego opisie jest lista problemów z numerami wierszy.

Sprawdzenie u siebie (opcjonalnie): `node narzedzia/zbuduj.mjs`.
