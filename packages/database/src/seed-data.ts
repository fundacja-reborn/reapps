/**
 * Demo data for seed script — PL/EN versions.
 * Used for screenshots and testing.
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
  dueDate?: string;
  hasTime?: boolean;
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
  username: 'amigo',
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
    dueDate: '2026-04-18',
    position: 0
  },
  {
    listKey: 'personal',
    title: { pl: 'Kupić prezent na urodziny Oli', en: 'Buy birthday gift for Ola' },
    isCompleted: false,
    isStarred: true,
    dueDate: '2026-04-12',
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
    dueDate: '2026-04-25',
    position: 3
  },
  {
    listKey: 'personal',
    title: { pl: 'Odebrać paczkę z paczkomatu', en: 'Pick up parcel from locker' },
    isCompleted: false,
    isStarred: false,
    dueDate: '2026-04-05',
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
      pl: 'Prezentacja wyników Q1 dla zespołu. Spotkanie w piątek o 10:00 w sali konferencyjnej B. Pamiętać o wykresach sprzedaży i porównaniu z poprzednim kwartałem.',
      en: 'Q1 results presentation for the team. Meeting on Friday at 10:00 in conference room B. Remember to include sales charts and comparison with previous quarter.'
    },
    isCompleted: false,
    isStarred: true,
    dueDate: '2026-04-10',
    hasTime: true,
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
    dueDate: '2026-04-05',
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
    dueDate: '2026-04-15',
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
    isCompleted: false,
    isStarred: false,
    position: 1
  },
  {
    listKey: 'shopping',
    title: { pl: 'Baterie do pilota', en: 'Batteries for remote' },
    isCompleted: false,
    isStarred: false,
    position: 2
  }
];

// ==================== FOLDERS ====================

export const FOLDERS: FolderData[] = [
  { key: 'personal', name: { pl: 'Osobiste', en: 'Personal' }, orderIndex: 0 },
  { key: 'work', name: { pl: 'Praca', en: 'Work' }, orderIndex: 1 },
  { key: 'learning', name: { pl: 'Nauka', en: 'Learning' }, orderIndex: 2 },
  { key: 'articles', name: { pl: 'Artykuły', en: 'Articles' }, orderIndex: 3 }
];

// ==================== TAGS ====================

export const TAGS: TagData[] = [
  { key: 'important', name: { pl: 'Ważne', en: 'Important' }, color: '#EF4444' },
  { key: 'travel', name: { pl: 'Podróże', en: 'Travel' }, color: '#3B82F6' },
  { key: 'ideas', name: { pl: 'Pomysły', en: 'Ideas' }, color: '#8B5CF6' },
  { key: 'growth', name: { pl: 'Rozwój', en: 'Growth' }, color: '#10B981' },
  { key: 'privacy', name: { pl: 'Prywatność', en: 'Privacy' }, color: '#F59E0B' }
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
- Biegać 3× w tygodniu (cel: 10 km bez przerwy)
- Regularny sen — 23:00 → 7:00

## Rozwój
- Ukończyć kurs TypeScript (do czerwca)
- Przeczytać 12 książek (1/miesiąc)

## Finanse
- Odłożyć 20% wypłaty co miesiąc
- Fundusz awaryjny: 3× miesięczne wydatki

## Podróże
- Lizbona w maju
- Weekend w górach — jesień`,
      en: `# Goals for 2026

## Health
- Run 3× per week (goal: 10 km non-stop)
- Regular sleep — 11 PM → 7 AM

## Growth
- Complete TypeScript course (by June)
- Read 12 books (1/month)

## Finances
- Save 20% of salary each month
- Emergency fund: 3× monthly expenses

## Travel
- Lisbon in May ✈️
- Mountain weekend — autumn`
    },
    isPinned: true,
    isStarred: false,
    orderIndex: 0,
    tagKeys: ['growth'],
    createdDaysAgo: 90
  },
  // --- Work ---
  {
    folderKey: 'work',
    title: { pl: 'Notatki ze spotkania — 2 kwietnia', en: 'Meeting notes — April 2nd' },
    content: {
      pl: `# Spotkanie zespołu — 2.04.2026

## Uczestnicy
Anna, Kasia, Marek, Tomek

## Tematy
1. **Status sprintu 14** — 8/12 story points zamknięte
2. **Demo dla klienta** — przesunięte na 10.04
3. **Nowy designer** — Marta dołącza od 14.04

## Akcje
- [ ] Marek: przygotować środowisko testowe
- [ ] Kasia: zaktualizować backlog sprintu 15
- [ ] Tomek: review PR-ów do piątku

Następne spotkanie: **9.04 o 10:00**`,
      en: `# Team Meeting — April 2, 2026

## Attendees
Anna, Kasia, Marek, Tomek

## Topics
1. **Sprint 14 status** — 8/12 story points closed
2. **Client demo** — moved to April 10
3. **New designer** — Marta joins April 14

## Actions
- [ ] Marek: prepare test environment
- [ ] Kasia: update sprint 15 backlog
- [ ] Tomek: review PRs by Friday

Next meeting: **April 9 at 10:00**`
    },
    isPinned: true,
    isStarred: false,
    orderIndex: 0,
    createdDaysAgo: 3
  },
  {
    folderKey: 'work',
    title: { pl: 'Pomysły na nową funkcjonalność', en: 'New feature ideas' },
    content: {
      pl: `# Pomysły na nowe funkcje 💡

## Priorytet wysoki
- **Eksport do PDF** — użytkownicy często proszą
- **Wyszukiwanie pełnotekstowe** — kluczowe dla dużych zbiorów notatek

## Priorytet średni
- Widok kanban dla zadań
- Wspólne listy zadań (shared lists)
- Notyfikacje push o terminach

## Do zbadania
- Integracja z kalendarzem (CalDAV?)
- Plugin do przeglądarki (quick capture)`,
      en: `# New Feature Ideas 💡

## High Priority
- **PDF export** — frequently requested by users
- **Full-text search** — critical for large note collections

## Medium Priority
- Kanban view for tasks
- Shared task lists
- Push notifications for deadlines

## To Research
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
    title: { pl: 'Kurs TypeScript — notatki', en: 'TypeScript course — notes' },
    content: {
      pl: `# TypeScript — notatki z kursu 📝

## Generics
\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}
\`\`\`
Generics pozwalają na tworzenie reużywalnych komponentów z zachowaniem typowania.

## Utility Types
- \`Partial<T>\` — wszystkie pola opcjonalne
- \`Required<T>\` — wszystkie pola wymagane
- \`Pick<T, K>\` — wybiór pól
- \`Omit<T, K>\` — pominięcie pól

## Discriminated Unions
Kluczowe dla pattern matchingu — używać wspólnego pola literalnego jako dyskryminatora.`,
      en: `# TypeScript — Course Notes 📝

## Generics
\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}
\`\`\`
Generics allow creating reusable components while preserving type safety.

## Utility Types
- \`Partial<T>\` — all fields optional
- \`Required<T>\` — all fields required
- \`Pick<T, K>\` — select specific fields
- \`Omit<T, K>\` — omit specific fields

## Discriminated Unions
Essential for pattern matching — use a shared literal field as the discriminator.`
    },
    isPinned: true,
    isStarred: true,
    orderIndex: 0,
    tagKeys: ['growth'],
    createdDaysAgo: 18
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

W świecie, w którym wycieki danych trafiają na nagłówki co tydzień, tradycyjne zabezpieczenia nie wystarczają.

## Czym jest Zero Knowledge?

Dostawca usługi ma **zerową wiedzę** o rzeczywistych danych. Informacje są szyfrowane na urządzeniu, zanim je opuszczą, a tylko Ty masz klucze do ich odszyfrowania.

## Jak to działa

1. Generowany jest główny klucz szyfrujący na urządzeniu
2. Klucz jest szyfrowany kluczem pochodnym od hasła (PBKDF2, 600K iteracji)
3. Tylko zaszyfrowany klucz trafia na serwer — nigdy prawdziwy klucz
4. Wszystkie dane szyfrowane AES-256-GCM przed wysłaniem

## Dlaczego to ważne

- **Wycieki danych nieszkodliwe** — atakujący znajdzie tylko zaszyfrowany szum
- **Brak zagrożenia wewnętrznego** — zespół nie może odczytać danych użytkowników
- **Brak tylnych drzwi** — nie da się oddać tego, czego nie ma
- **Dane pod kontrolą użytkownika** — klucze nigdy nie opuszczają urządzenia

## Kompromis

Brak możliwości odzyskania danych bez hasła. Kody odzyskiwania to jedyna droga awaryjna. To feature, nie bug.`,
      en: `# Why Zero Knowledge Encryption Matters

In a world where data breaches make headlines every week, traditional security isn't enough.

## What is Zero Knowledge?

The service provider has **zero knowledge** of your actual data. Information is encrypted on your device before it leaves, and only you hold the keys to decrypt it.

## How It Works

1. A master encryption key is generated on your device
2. That key is encrypted with a password-derived key (PBKDF2, 600K iterations)
3. Only the encrypted key is sent to the server — never the real key
4. All data encrypted with AES-256-GCM before transmission

## Why It Matters

- **Data breaches become harmless** — attackers find only encrypted noise
- **No insider threat** — the team cannot read user data
- **No backdoors** — can't hand over what you don't have
- **User-controlled data** — encryption keys never leave the device

## The Trade-off

Data cannot be recovered without the password. Recovery codes are the only fallback. It's a feature, not a bug.`
    },
    isPinned: false,
    isStarred: true,
    orderIndex: 0,
    tagKeys: ['privacy'],
    createdDaysAgo: 20
  },
  {
    folderKey: 'articles',
    title: { pl: 'Przedstawiamy Reborn Apps', en: 'Introducing Reborn Apps' },
    content: {
      pl: `# Przedstawiamy Reborn Apps

**Reborn Apps** — narzędzia produktywności z E2E encryption, tworzone przez europejską fundację non-profit.

## Problem

Większość appek produktywności traktuje dane użytkowników jako swój produkt — analizuje nawyki, wyświetla reklamy, przechowuje wszystko w plaintext.

Reborn Apps opiera się na zasadzie: **Twoje dane należą do Ciebie**.

## Aplikacje

### re/task
Menedżer zadań: listy, podzadania, gwiazdki, zadania cykliczne, tryb offline-first, pełne E2E encryption.

### re/notes
Notatki: edytor Markdown, foldery, tagi, tryb offline-first, E2E encryption.

## Wartości

- **Open source** — kod na licencji AGPL-3.0
- **Non-profit** — Fundacja Reborn, Polska
- **Europejskie** — hosting w Niemczech, RODO
- **Darmowe** — bez reklam, bez śledzenia`,
      en: `# Introducing Reborn Apps

**Reborn Apps** — productivity tools with E2E encryption, built by a European non-profit foundation.

## The Problem

Most productivity apps treat user data as their product — analyzing habits, serving ads, storing everything in plaintext.

Reborn Apps is built on one principle: **Your data belongs to you**.

## Apps

### re/task
Task manager: lists, subtasks, stars, recurring tasks, offline-first mode, full E2E encryption.

### re/notes
Notes: Markdown editor, folders, tags, offline-first mode, E2E encryption.

## Values

- **Open source** — AGPL-3.0 licensed
- **Non-profit** — Reborn Foundation, Poland
- **European** — hosted in Germany, GDPR compliant
- **Free** — no ads, no tracking`
    },
    isPinned: true,
    isStarred: false,
    orderIndex: 1,
    createdDaysAgo: 25
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

Serwer **nigdy nie ma dostępu** do danych w postaci jawnej. Szyfrowanie i deszyfrowanie wyłącznie na urządzeniu użytkownika.

### Co serwer widzi
- Nazwa użytkownika, hash hasła (Argon2id), zaszyfrowany klucz główny
- ID rekordów (UUID), znaczniki czasu, klucze obce

### Czego serwer nie widzi
- Treść zadań, notatek, opisy, nazwy list/folderów/tagów
- Status ukończenia, gwiazdki, terminy, powiązania tagów
- Dane PII (poza nazwą użytkownika)

## Kryptografia

| Cel | Algorytm |
|-----|----------|
| Hash hasła | Argon2id (m=19456, t=3, p=1) |
| Derywacja klucza | PBKDF2 600K iteracji, SHA-256 |
| Szyfrowanie danych | AES-GCM 256-bit |
| Tokeny | JWT HMAC-SHA256 z rotacją sekretów |

## Zabezpieczenia

- Brute-force: 5 prób → 15 min lockout
- Refresh token rotation z family tracking
- HSTS + CSP nonce-based
- Walidacja Zod + sanityzacja DOMPurify
- Idempotentna synchronizacja offline`,
      en: `# Reborn Apps Security Overview

## Zero Knowledge Architecture

The server **never has access** to plaintext data. All encryption and decryption happens exclusively on the user's device.

### What the server sees
- Username, password hash (Argon2id), encrypted master key
- Record IDs (UUID), timestamps, foreign keys

### What the server never sees
- Task content, notes, descriptions, list/folder/tag names
- Completion status, stars, due dates, tag associations
- PII data (beyond username)

## Cryptography

| Purpose | Algorithm |
|---------|-----------|
| Password hash | Argon2id (m=19456, t=3, p=1) |
| Key derivation | PBKDF2 600K iterations, SHA-256 |
| Data encryption | AES-GCM 256-bit |
| Tokens | JWT HMAC-SHA256 with secret rotation |

## Security Measures

- Brute-force: 5 attempts → 15 min lockout
- Refresh token rotation with family tracking
- HSTS + nonce-based CSP
- Zod validation + DOMPurify sanitization
- Idempotent offline sync`
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 2,
    tagKeys: ['privacy', 'important'],
    createdDaysAgo: 4
  },
  {
    folderKey: 'articles',
    title: {
      pl: 'Self-hosting Reborn Apps z Docker Compose',
      en: 'Self-hosting Reborn Apps with Docker Compose'
    },
    content: {
      pl: `# Self-hosting Reborn Apps z Docker Compose

Jak uruchomić własną instancję Reborn Apps na serwerze.

## Wymagania

- Docker i Docker Compose
- Serwer z min. 2 GB RAM
- Domena (opcjonalna, ale zalecana)

## Szybki start

\`\`\`bash
git clone https://github.com/fundacja-reborn/reapps.git
cd reborn-apps
cp .env.example .env
docker compose up -d
\`\`\`

Uruchomi: PostgreSQL + re/task + re/notes.

## Konfiguracja (.env)

- \`DATABASE_URL\` — connection string PostgreSQL
- \`JWT_SECRET\` — sekret JWT
- \`ARGON2_MEMORY\` — koszt pamięci hashowania haseł

## HTTPS z reverse proxy

\`\`\`bash
docker compose -f docker-compose.yml \\
  -f docker-compose.proxy.yml up -d
\`\`\`

## Dlaczego self-hosting?

- **Pełna kontrola** nad danymi
- **Własna domena**
- **Wymogi regulacyjne** — wewnętrzne polityki
- **To samo E2E encryption** — szyfrowanie działa identycznie`,
      en: `# Self-hosting Reborn Apps with Docker Compose

How to run your own Reborn Apps instance on a server.

## Requirements

- Docker and Docker Compose
- Server with at least 2 GB RAM
- Domain name (optional but recommended)

## Quick Start

\`\`\`bash
git clone https://github.com/fundacja-reborn/reapps.git
cd reborn-apps
cp .env.example .env
docker compose up -d
\`\`\`

Starts: PostgreSQL + re/task + re/notes.

## Configuration (.env)

- \`DATABASE_URL\` — PostgreSQL connection string
- \`JWT_SECRET\` — JWT signing secret
- \`ARGON2_MEMORY\` — password hashing memory cost

## HTTPS with reverse proxy

\`\`\`bash
docker compose -f docker-compose.yml \\
  -f docker-compose.proxy.yml up -d
\`\`\`

## Why self-host?

- **Full control** over your data
- **Custom domain**
- **Regulatory requirements** — internal data policies
- **Same E2E encryption** — encryption works identically`
    },
    isPinned: false,
    isStarred: false,
    orderIndex: 3,
    createdDaysAgo: 30
  }
];
