# Paczki skał Cruxlog

Paczki skał i dróg do pobrania w aplikacji Cruxlog (Ustawienia › Paczki skał). Wszystkie dane są własne, zebrane w terenie, bez treści z przewodników i serwisów.

## Co tu jest

- `baza/baza.csv` – **cała baza skał w jednym pliku**, we wzorze Cruxlog (jeden wiersz = jedna droga; opis kolumn: `docs/IMPORT.md` w repozytorium aplikacji). Kolejność kolumn dowolna, liczą się nazwy nagłówków.
- `paczki/` – paczki zbudowane automatycznie: **jedna paczka = jedna grupa skał** (pierwszy poziom kolumny Grupa, np. Kamieniec). Skały bez grupy trafiają do paczki „<Rejon> – pozostałe skały”.
- `index.json` – spis paczek, który czyta aplikacja.
- `NASTEPNE_NUMERY.txt` – następne wolne numery skały i drogi.
- `narzedzia/numery.json` – pamięć nadanych numerów (nie edytuj).

Nie edytuj ręcznie `paczki/`, `index.json` ani `narzedzia/numery.json`: po każdej zmianie w `baza/` GitHub sam je przebuduje (zakładka Actions › „Zbuduj paczki”, około minuty).

## Dopisywanie i poprawianie dróg

1. **Pobierz aktualny plik**: `baza` › `baza.csv` › przycisk pobierania („Download raw file”). Zawsze zaczynaj od najnowszej wersji z GitHuba – automat dopisuje w niej numery.
2. Otwórz go w Excelu albo Arkuszach Google. **Nowe drogi dopisuj na końcu**, kolumny **ID_skały** i **ID_drogi** zostaw puste.
3. Zapisz jako CSV (UTF-8, średnik) i wgraj z powrotem: folder `baza` › „Add file” › „Upload files”, **pod tą samą nazwą** `baza.csv`, zatwierdź.
4. Po około minucie automat:
   - nada brakujące numery (nowa skała: kolejny `sk-…`, nowa droga: kolejny `dr-…`; droga na znanej skale dostaje numer tej skały) i wpisze je do `baza/baza.csv`,
   - zbuduje paczki; w aplikacji zmienione paczki pokażą „Dostępna aktualizacja”.

Zmiana nazwy drogi albo skały jest bezpieczna, bo numer stoi w tym samym wierszu: przejścia użytkowników zostają. Numerów raz nadanych nie zmieniaj.

Gdy przez pomyłkę poprawisz starą kopię bez numerów, automat przywróci dawne numery wierszom o tej samej skale, sektorze i nazwie. Nie zadziała to tylko dla dróg, którym w tej starej kopii zmieniłeś nazwę.

## Zasady

- Jedna skała należy do jednej grupy.
- Ten sam numer nie może być przy dwóch różnych drogach ani skałach.

Gdy coś jest nie tak, „Zbuduj paczki” kończy się na czerwono, a w jego opisie jest lista problemów z numerami wierszy. Wtedy popraw plik i wgraj go jeszcze raz.

Sprawdzenie u siebie (opcjonalnie): `node narzedzia/zbuduj.mjs`.
