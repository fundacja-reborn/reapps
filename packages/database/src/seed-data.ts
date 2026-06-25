/**
 * Demo data for seed script - PL/EN versions.
 * Used for store/website screenshots and testing.
 *
 * Task due dates are RELATIVE (dueInDays) so a fresh seed always renders a
 * healthy Overdue / Today / Tomorrow / Upcoming spread regardless of seed date.
 * Note dates are relative too (createdDaysAgo).
 */

export type Lang = 'pl' | 'en';

export interface TaskListData {
  key: string;
  name: Record<Lang, string>;
  isDefault: boolean;
  orderIndex: number;
}

export interface TaskData {
  listKey: string;
  title: Record<Lang, string>;
  description?: Record<Lang, string>;
  isCompleted: boolean;
  isStarred: boolean;
  /** Days from seed time until due (negative = overdue, 0 = today). Omit = no due date. */
  dueInDays?: number;
  /** Local 'HH:MM'; when set, the task has a specific time (has_time = true). */
  dueTime?: string;
  /** Days ago the task was completed; only used when isCompleted (default 0 = today). */
  completedDaysAgo?: number;
  position: number;
  subtasks?: SubtaskData[];
}

export interface SubtaskData {
  name: Record<Lang, string>;
  isCompleted: boolean;
  position: number;
}

export interface FolderData {
  key: string;
  name: Record<Lang, string>;
  orderIndex: number;
}

export interface TagData {
  key: string;
  name: Record<Lang, string>;
  color: string;
}

export interface NoteData {
  folderKey: string;
  title: Record<Lang, string>;
  content: Record<Lang, string>;
  isPinned: boolean;
  isStarred: boolean;
  orderIndex: number;
  tagKeys?: string[];
  /** How many days ago the note was "created" (0 = today) */
  createdDaysAgo: number;
}

// ==================== DEMO USER ====================

export const DEMO_USER = {
  username: 'demo',
  password: 'Demo1234!'
};

// ==================== TASK LISTS ====================

export const TASK_LISTS: TaskListData[] = [
  { key: 'personal', name: { pl: 'Osobiste', en: 'Personal' }, isDefault: true, orderIndex: 0 },
  { key: 'work', name: { pl: 'Praca', en: 'Work' }, isDefault: false, orderIndex: 1 },
  { key: 'shopping', name: { pl: 'Zakupy', en: 'Shopping' }, isDefault: false, orderIndex: 2 }
];

// ==================== TASKS ====================

export const TASKS: TaskData[] = [
  // --- Personal ---
  {
    listKey: 'personal',
    title: { pl: 'Odnowić paszport', en: 'Renew passport' },
    isCompleted: false,
    isStarred: false,
    dueInDays: 21,
    position: 0
  },
  {
    listKey: 'personal',
    title: { pl: 'Kupić prezent na urodziny Oli', en: 'Buy birthday gift for Ola' },
    isCompleted: false,
    isStarred: true,
    dueInDays: 3,
    position: 1
  },
  {
    listKey: 'personal',
    title: { pl: 'Zapisać się na zajęcia jogi', en: 'Sign up for yoga classes' },
    isCompleted: false,
    isStarred: false,
    position: 2
  },
  {
    listKey: 'personal',
    title: { pl: 'Wymienić olej w samochodzie', en: 'Change car oil' },
    isCompleted: false,
    isStarred: false,
    dueInDays: 12,
    position: 3
  },
  {
    listKey: 'personal',
    title: { pl: 'Odebrać paczkę z paczkomatu', en: 'Pick up parcel from locker' },
    isCompleted: false,
    isStarred: false,
    dueInDays: 1,
    position: 4
  },
  // --- Work ---
  {
    listKey: 'work',
    title: {
      pl: 'Przygotować prezentację kwartalną',
      en: 'Prepare quarterly presentation'
    },
    description: {
      pl: 'Prezentacja wyników Q1 dla zespołu. Spotkanie w sali konferencyjnej B. Pamiętać o wykresach sprzedaży i porównaniu z poprzednim kwartałem.',
      en: 'Q1 results presentation for the team. Meeting in conference room B. Remember to include sales charts and a comparison with the previous quarter.'
    },
    isCompleted: false,
    isStarred: true,
    dueInDays: 2,
    dueTime: '10:00',
    position: 0,
    subtasks: [
      {
        name: { pl: 'Zebrać dane sprzedażowe z CRM', en: 'Collect sales data from CRM' },
        isCompleted: true,
        position: 0
      },
      {
        name: {
          pl: 'Przygotować wykresy w arkuszu',
          en: 'Prepare charts in spreadsheet'
        },
        isCompleted: false,
        position: 1
      },
      {
        name: {
          pl: 'Wysłać draft do przeglądu Kasi',
          en: 'Send draft to Kasia for review'
        },
        isCompleted: false,
        position: 2
      }
    ]
  },
  {
    listKey: 'work',
    title: { pl: 'Odpowiedzieć na maila od klienta', en: 'Reply to client email' },
    isCompleted: false,
    isStarred: false,
    dueInDays: -1,
    position: 1
  },
  {
    listKey: 'work',
    title: { pl: 'Przejrzeć pull request #142', en: 'Review pull request #142' },
    isCompleted: false,
    isStarred: false,
    position: 2
  },
  {
    listKey: 'work',
    title: { pl: 'Zaktualizować dokumentację API', en: 'Update API documentation' },
    isCompleted: false,
    isStarred: false,
    dueInDays: 5,
    position: 3
  },
  // --- Shopping ---
  {
    listKey: 'shopping',
    title: { pl: 'Brokuły, marchew, migdały', en: 'Broccoli, carrots, almonds' },
    isCompleted: false,
    isStarred: false,
    position: 0
  },
  {
    listKey: 'shopping',
    title: { pl: 'Nowy kabel USB-C', en: 'New USB-C cable' },
    isCompleted: true,
    isStarred: false,
    completedDaysAgo: 1,
    position: 1
  },
  {
    listKey: 'shopping',
    title: { pl: 'Baterie do pilota', en: 'Batteries for remote' },
    isCompleted: true,
    isStarred: false,
    completedDaysAgo: 0,
    position: 2
  }
];

// ==================== FOLDERS ====================

export const FOLDERS: FolderData[] = [
  { key: 'personal', name: { pl: 'Osobiste', en: 'Personal' }, orderIndex: 0 },
  { key: 'work', name: { pl: 'Praca', en: 'Work' }, orderIndex: 1 },
  { key: 'learning', name: { pl: 'Nauka', en: 'Learning' }, orderIndex: 2 },
  { key: 'projects', name: { pl: 'Projekty', en: 'Projects' }, orderIndex: 3 },
  { key: 'articles', name: { pl: 'Artykuły', en: 'Articles' }, orderIndex: 4 }
];

// ==================== TAGS ====================

export const TAGS: TagData[] = [
  { key: 'important', name: { pl: 'Ważne', en: 'Important' }, color: '#EF4444' },
  { key: 'travel', name: { pl: 'Podróże', en: 'Travel' }, color: '#3B82F6' },
  { key: 'ideas', name: { pl: 'Pomysły', en: 'Ideas' }, color: '#8B5CF6' },
  { key: 'growth', name: { pl: 'Rozwój', en: 'Growth' }, color: '#10B981' },
  { key: 'privacy', name: { pl: 'Prywatność', en: 'Privacy' }, color: '#F59E0B' },
  { key: 'dev', name: { pl: 'Programowanie', en: 'Dev' }, color: '#06B6D4' }
];

// ==================== NOTES ====================

export const NOTES: NoteData[] = [
  // --- Personal ---
  {
    folderKey: 'personal',
    title: { pl: 'Cele na 2026 rok', en: 'Goals for 2026' },
    content: {
      pl: `# Cele na 2026

## Zdrowie
- Biegać 3 razy w tygodniu (cel: 10 km bez przerwy)
- Regularny sen: 23:00 -> 7:00
- Mniej kawy, więcej wody

## Rozwój
- Ukończyć kurs TypeScript (do czerwca)
- Przeczytać 12 książek (1 na miesiąc)
- Nauczyć się podstaw hiszpańskiego (poziom A2)

## Finanse
- Odkładać 20% wypłaty co miesiąc
- Fundusz awaryjny: 3-krotność miesięcznych wydatków

## Podróże
- Lizbona w maju ✈️
- Weekend w górach jesienią`,
      en: `# Goals for 2026

## Health
- Run 3 times a week (goal: 10 km non-stop)
- Regular sleep: 11 PM -> 7 AM
- Less coffee, more water

## Growth
- Finish the TypeScript course (by June)
- Read 12 books (1 per month)
- Learn the basics of Spanish (level A2)

## Finances
- Save 20% of each paycheck
- Emergency fund: 3x monthly expenses

## Travel
- Lisbon in May ✈️
- Mountain weekend in autumn`
    },
    isPinned: true,
    isStarred: false,
    orderIndex: 0,
    tagKeys: ['growth'],
    createdDaysAgo: 90
  },
  {
    folderKey: 'personal',
    title: { pl: 'Plan podróży - Lizbona', en: 'Lisbon trip plan' },
    content: {
      pl: `# Plan podróży - Lizbona 🇵🇹

Pięć dni w maju. Lot z Krakowa, nocleg w dzielnicy Alfama.

## Plan dnia

| Dzień | Plan |
| --- | --- |
| Pon | Przylot, spacer po Alfamie, kolacja z fado |
| Wt | Belém: wieża, klasztor, pastéis de nata |
| Śr | Sintra: pałac Pena i Quinta da Regaleira |
| Czw | Tramwaj 28, dzielnica Bairro Alto |
| Pt | Targ Time Out, zakupy, powrót |

## Do spakowania
- [x] Paszport i bilety
- [x] Ładowarka i powerbank
- [ ] Krem z filtrem
- [ ] Wygodne buty
- [ ] Adapter do gniazdek

> Wskazówka: bilet Lisboa Card obejmuje komunikację miejską i wstęp do większości muzeów.

Rezerwacje: [booking.com](https://www.booking.com)`,
      en: `# Lisbon trip plan 🇵🇹

Five days in May. Flight from Krakow, staying in the Alfama district.

## Day plan

| Day | Plan |
| --- | --- |
| Mon | Arrival, walk around Alfama, fado dinner |
| Tue | Belém: tower, monastery, pastéis de nata |
| Wed | Sintra: Pena Palace and Quinta da Regaleira |
| Thu | Tram 28, Bairro Alto district |
| Fri | Time Out Market, shopping, flight home |

## Packing list
- [x] Passport and tickets
- [x] Charger and power bank
- [ ] Sunscreen
- [ ] Comfortable shoes
- [ ] Plug adapter

> Tip: the Lisboa Card covers public transport and entry to most museums.

Bookings: [booking.com](https://www.booking.com)`
    },
    isPinned: true,
    isStarred: true,
    orderIndex: 1,
    tagKeys: ['travel', 'important'],
    createdDaysAgo: 7
  },
  {
    folderKey: 'personal',
    title: { pl: 'Przepis na ciasto marchewkowe', en: 'Carrot cake recipe' },
    content: {
      pl: `# Przepis na ciasto marchewkowe 🥕

Wilgotne, korzenne, gotowe w godzinę.

## Składniki
- 3 średnie marchewki (starte)
- 2 szklanki mąki
- 1 szklanka cukru trzcinowego
- 3 jajka
- 1 szklanka oleju
- 2 łyżeczki cynamonu
- 1 łyżeczka sody oczyszczonej

## Przygotowanie
1. Rozgrzej piekarnik do 180°C.
2. Wymieszaj suche składniki w dużej misce.
3. Dodaj jajka i olej, połącz na gładką masę.
4. Wmieszaj startą marchewkę.
5. Przelej do formy i piecz 45 minut.

> Sprawdź patyczkiem: jeśli wychodzi suchy, ciasto jest gotowe.`,
      en: `# Carrot cake recipe 🥕

Moist, spiced, ready in an hour.

## Ingredients
- 3 medium carrots (grated)
- 2 cups flour
- 1 cup cane sugar
- 3 eggs
- 1 cup oil
- 2 tsp cinnamon
- 1 tsp baking soda

## Steps
1. Preheat the oven to 180°C.
2. Mix the dry ingredients in a large bowl.
3. Add the eggs and oil, blend until smooth.
4. Fold in the grated carrots.
5. Pour into a tin and bake for 45 minutes.

> Test with a toothpick: if it comes out dry, the cake is done.`
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 2,
    createdDaysAgo: 40
  },
  // --- Work ---
  {
    folderKey: 'work',
    title: { pl: 'Notatki ze spotkania - 20 czerwca', en: 'Meeting notes - June 20' },
    content: {
      pl: `# Spotkanie zespołu - 20 czerwca 2026

## Uczestnicy
Anna, Kasia, Marek, Tomek

## Tematy
1. **Status sprintu 14** - zamknięte 8 z 12 story points
2. **Demo dla klienta** - przesunięte na 26 czerwca
3. **Nowy projektant** - Marta dołącza 1 lipca

## Akcje
- [x] Anna: wysłać podsumowanie sprintu
- [ ] Marek: przygotować środowisko testowe
- [ ] Kasia: zaktualizować backlog sprintu 15
- [ ] Tomek: przejrzeć PR-y do piątku

Następne spotkanie: **27 czerwca o 10:00**`,
      en: `# Team meeting - June 20, 2026

## Attendees
Anna, Kasia, Marek, Tomek

## Topics
1. **Sprint 14 status** - 8 of 12 story points closed
2. **Client demo** - moved to June 26
3. **New designer** - Marta joins July 1

## Actions
- [x] Anna: send the sprint summary
- [ ] Marek: prepare the test environment
- [ ] Kasia: update the sprint 15 backlog
- [ ] Tomek: review PRs by Friday

Next meeting: **June 27 at 10:00**`
    },
    isPinned: true,
    isStarred: false,
    orderIndex: 0,
    createdDaysAgo: 5
  },
  {
    folderKey: 'work',
    title: { pl: 'Pomysły na nową funkcjonalność', en: 'New feature ideas' },
    content: {
      pl: `# Pomysły na nowe funkcje 💡

## Priorytet wysoki
- **Eksport do PDF** - często proszą o to użytkownicy
- **Wyszukiwanie pełnotekstowe** - kluczowe przy dużych zbiorach notatek

## Priorytet średni
- Widok kanban dla zadań
- Współdzielone listy zadań
- Powiadomienia push o terminach

## Do zbadania
- Integracja z kalendarzem (CalDAV?)
- Wtyczka do przeglądarki (szybkie zapisywanie)`,
      en: `# New feature ideas 💡

## High priority
- **PDF export** - frequently requested by users
- **Full-text search** - critical for large note collections

## Medium priority
- Kanban view for tasks
- Shared task lists
- Push notifications for deadlines

## To research
- Calendar integration (CalDAV?)
- Browser extension (quick capture)`
    },
    isPinned: false,
    isStarred: true,
    orderIndex: 1,
    tagKeys: ['ideas'],
    createdDaysAgo: 14
  },
  // --- Learning ---
  {
    folderKey: 'learning',
    title: { pl: 'Kurs TypeScript - notatki', en: 'TypeScript course - notes' },
    content: {
      pl: `# TypeScript - notatki z kursu 📝

## Generyki
\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}

const first = <T>(arr: T[]): T | undefined => arr[0];
\`\`\`
Generyki pozwalają pisać reużywalne funkcje bez utraty informacji o typach.

## Typy narzędziowe
- \`Partial<T>\` - wszystkie pola opcjonalne
- \`Required<T>\` - wszystkie pola wymagane
- \`Pick<T, K>\` - wybrane pola
- \`Omit<T, K>\` - wszystko poza K

## Unie rozłączne
\`\`\`typescript
type Result =
  | { status: 'ok'; data: string }
  | { status: 'error'; message: string };

function handle(r: Result) {
  if (r.status === 'ok') return r.data;
  return r.message;
}
\`\`\`

> Wspólne pole literalne (tutaj \`status\`) działa jak dyskryminator przy zawężaniu typów.`,
      en: `# TypeScript - course notes 📝

## Generics
\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}

const first = <T>(arr: T[]): T | undefined => arr[0];
\`\`\`
Generics let you write reusable functions without losing type information.

## Utility types
- \`Partial<T>\` - all fields optional
- \`Required<T>\` - all fields required
- \`Pick<T, K>\` - select specific fields
- \`Omit<T, K>\` - everything except K

## Discriminated unions
\`\`\`typescript
type Result =
  | { status: 'ok'; data: string }
  | { status: 'error'; message: string };

function handle(r: Result) {
  if (r.status === 'ok') return r.data;
  return r.message;
}
\`\`\`

> A shared literal field (here \`status\`) acts as a discriminator when narrowing types.`
    },
    isPinned: true,
    isStarred: true,
    orderIndex: 0,
    tagKeys: ['growth', 'dev'],
    createdDaysAgo: 18
  },
  {
    folderKey: 'learning',
    title: { pl: 'Python - praca z danymi', en: 'Python - working with data' },
    content: {
      pl: `# Python - praca z danymi 🐍

## Listy składane
\`\`\`python
numbers = [1, 2, 3, 4, 5, 6]
evens = [n for n in numbers if n % 2 == 0]
squares = {n: n * n for n in numbers}
print(evens)    # [2, 4, 6]
\`\`\`

## Zliczanie z collections
\`\`\`python
from collections import Counter

words = "jabłko banan jabłko wiśnia banan jabłko".split()
counts = Counter(words)
print(counts.most_common(2))  # [('jabłko', 3), ('banan', 2)]
\`\`\`

## Wskazówki
- \`enumerate(seq)\` zamiast ręcznego licznika
- \`zip(a, b)\` do równoległej iteracji
- f-stringi do formatowania: \`f"suma: {total}"\``,
      en: `# Python - working with data 🐍

## List comprehensions
\`\`\`python
numbers = [1, 2, 3, 4, 5, 6]
evens = [n for n in numbers if n % 2 == 0]
squares = {n: n * n for n in numbers}
print(evens)    # [2, 4, 6]
\`\`\`

## Counting with collections
\`\`\`python
from collections import Counter

words = "apple banana apple cherry banana apple".split()
counts = Counter(words)
print(counts.most_common(2))  # [('apple', 3), ('banana', 2)]
\`\`\`

## Tips
- \`enumerate(seq)\` instead of a manual counter
- \`zip(a, b)\` for parallel iteration
- f-strings for formatting: \`f"total: {total}"\``
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 1,
    tagKeys: ['dev'],
    createdDaysAgo: 10
  },
  // --- Projects ---
  {
    folderKey: 'projects',
    title: { pl: 'Runbook wdrożenia API', en: 'API deployment runbook' },
    content: {
      pl: `# Runbook wdrożenia API 🚀

Kroki wdrożenia nowej wersji na produkcję.

## Przed wdrożeniem
- [x] Testy zielone na CI
- [x] Migracje sprawdzone na stagingu
- [ ] Wpis w changelogu

## Deploy
\`\`\`bash
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm db:migrate
docker compose up -d --build
\`\`\`

## Fragment docker-compose
\`\`\`yaml
services:
  api:
    image: reborn/api:latest
    restart: unless-stopped
    ports:
      - "4000:4000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
\`\`\`

> Uwaga: jeśli healthcheck nie przejdzie w 60 sekund, wycofaj się do poprzedniego obrazu.`,
      en: `# API deployment runbook 🚀

Steps for shipping a new version to production.

## Before deploy
- [x] Tests green on CI
- [x] Migrations verified on staging
- [ ] Changelog entry added

## Deploy
\`\`\`bash
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm db:migrate
docker compose up -d --build
\`\`\`

## docker-compose snippet
\`\`\`yaml
services:
  api:
    image: reborn/api:latest
    restart: unless-stopped
    ports:
      - "4000:4000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
\`\`\`

> Warning: if the healthcheck fails within 60 seconds, roll back to the previous image.`
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 0,
    tagKeys: ['dev', 'important'],
    createdDaysAgo: 6
  },
  // --- Articles (from blog) ---
  {
    folderKey: 'articles',
    title: {
      pl: 'Dlaczego szyfrowanie Zero Knowledge ma znaczenie',
      en: 'Why Zero Knowledge encryption matters'
    },
    content: {
      pl: `# Dlaczego szyfrowanie Zero Knowledge ma znaczenie

Wycieki danych trafiają na nagłówki niemal co tydzień. Tradycyjne zabezpieczenia już nie wystarczają.

## Czym jest Zero Knowledge
Dostawca usługi ma **zerową wiedzę** o Twoich danych. Wszystko jest szyfrowane na urządzeniu, zanim je opuści, a klucze masz tylko Ty.

## Jak to działa
1. Główny klucz szyfrujący powstaje na Twoim urządzeniu.
2. Klucz jest opakowany kluczem pochodnym od hasła (PBKDF2, 600 000 iteracji).
3. Na serwer trafia tylko zaszyfrowany klucz, nigdy ten prawdziwy.
4. Wszystkie dane są szyfrowane AES-256-GCM przed wysłaniem.

## Dlaczego to ważne
- **Wycieki stają się nieszkodliwe** - atakujący widzi tylko szum.
- **Brak zagrożenia wewnętrznego** - zespół nie odczyta Twoich danych.
- **Brak tylnych drzwi** - nie da się wydać tego, czego się nie ma.
- **Dane pod Twoją kontrolą** - klucze nie opuszczają urządzenia.

## Kompromis
Bez hasła danych nie da się odzyskać. Kody odzyskiwania to jedyna droga awaryjna. To cecha, nie błąd.`,
      en: `# Why Zero Knowledge encryption matters

Data breaches make headlines almost every week. Traditional security is no longer enough.

## What Zero Knowledge means
The service provider has **zero knowledge** of your data. Everything is encrypted on your device before it leaves, and only you hold the keys.

## How it works
1. A master encryption key is generated on your device.
2. The key is wrapped with a password-derived key (PBKDF2, 600,000 iterations).
3. Only the encrypted key reaches the server, never the real one.
4. All data is encrypted with AES-256-GCM before transmission.

## Why it matters
- **Breaches become harmless** - attackers see only noise.
- **No insider threat** - the team cannot read your data.
- **No backdoors** - you cannot hand over what you do not have.
- **You control your data** - keys never leave your device.

## The trade-off
Without your password, data cannot be recovered. Recovery codes are the only fallback. It is a feature, not a bug.`
    },
    isPinned: false,
    isStarred: true,
    orderIndex: 0,
    tagKeys: ['privacy'],
    createdDaysAgo: 22
  },
  {
    folderKey: 'articles',
    title: {
      pl: 'Przegląd bezpieczeństwa Reborn Apps',
      en: 'Reborn Apps security overview'
    },
    content: {
      pl: `# Przegląd bezpieczeństwa Reborn Apps

## Architektura Zero Knowledge
Serwer **nigdy** nie widzi danych w postaci jawnej. Szyfrowanie i deszyfrowanie dzieją się wyłącznie na urządzeniu użytkownika.

### Co serwer widzi
- Nazwę użytkownika, hash hasła (Argon2id), zaszyfrowany klucz główny
- Identyfikatory rekordów (UUID), znaczniki czasu, klucze obce

### Czego serwer nie widzi
- Treści zadań i notatek, opisów, nazw list, folderów i tagów
- Statusu ukończenia, gwiazdek, terminów, powiązań z tagami

## Kryptografia
| Cel | Algorytm |
| --- | --- |
| Hash hasła | Argon2id (m=19456, t=3, p=1) |
| Pochodna klucza | PBKDF2, 600 000 iteracji, SHA-256 |
| Szyfrowanie danych | AES-GCM 256-bit |
| Tokeny | JWT HMAC-SHA256 z rotacją sekretów |

## Dodatkowe zabezpieczenia
- Brute-force: 5 prób, potem 15 minut blokady
- Rotacja refresh tokenów ze śledzeniem rodziny
- HSTS oraz CSP oparte na nonce
- Walidacja Zod i sanityzacja DOMPurify`,
      en: `# Reborn Apps security overview

## Zero Knowledge architecture
The server **never** sees plaintext data. Encryption and decryption happen only on the user's device.

### What the server sees
- Username, password hash (Argon2id), encrypted master key
- Record IDs (UUID), timestamps, foreign keys

### What the server never sees
- Task and note content, descriptions, list, folder and tag names
- Completion status, stars, due dates, tag associations

## Cryptography
| Purpose | Algorithm |
| --- | --- |
| Password hash | Argon2id (m=19456, t=3, p=1) |
| Key derivation | PBKDF2, 600,000 iterations, SHA-256 |
| Data encryption | AES-GCM 256-bit |
| Tokens | JWT HMAC-SHA256 with secret rotation |

## Extra protections
- Brute-force: 5 attempts, then a 15-minute lockout
- Refresh token rotation with family tracking
- HSTS and nonce-based CSP
- Zod validation and DOMPurify sanitization`
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 1,
    tagKeys: ['privacy', 'important'],
    createdDaysAgo: 4
  }
];
