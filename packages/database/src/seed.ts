import { prisma } from './client.js';
import { createLogger } from '@reborn/utils';
import { CryptoManager, hashPassword, loadUserMasterKey } from '@reborn/crypto';
import type {
  TaskSensitiveMetadata,
  SubtaskSensitiveMetadata,
  NoteSensitiveMetadata
} from '@reborn/types';
import {
  DEMO_USER,
  TASK_LISTS,
  TASKS,
  FOLDERS,
  TAGS,
  NOTES,
  type Lang,
  type TaskData
} from './seed-data.js';

const logger = createLogger('Database:Seed');

// ==================== HELPERS ====================

/**
 * Resolve a task's relative due offset into the string the app stores.
 * Date-only dues become `YYYY-MM-DD`; timed dues become a full ISO timestamp
 * with `has_time = true`. Computed at seed time so screenshots always show a
 * fresh Overdue / Today / Tomorrow / Upcoming spread.
 */
function computeDue(task: TaskData): { dueDate: string | null; hasTime: boolean } {
  if (task.dueInDays === undefined) return { dueDate: null, hasTime: false };

  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + task.dueInDays);

  if (task.dueTime) {
    const [h, m] = task.dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return { dueDate: d.toISOString(), hasTime: true };
  }

  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return { dueDate: `${y}-${mo}-${da}`, hasTime: false };
}

/** ISO timestamp N days ago, for the completed_at field of finished tasks. */
function computeCompletedAt(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function parseLang(args: string[]): Lang {
  const langIdx = args.indexOf('--lang');
  if (langIdx !== -1 && args[langIdx + 1]) {
    const val = args[langIdx + 1];
    if (val === 'pl' || val === 'en') return val;
    logger.error(`Invalid language: "${val}". Use "pl" or "en".`);
    process.exit(1);
  }
  return 'pl';
}

function isClearOnly(args: string[]): boolean {
  return args.includes('--clear');
}

// ==================== CLEAR DATABASE ====================

async function clearDatabase(): Promise<void> {
  logger.info('Czyszczenie bazy danych...');

  // Delete in correct order to respect foreign key constraints
  await prisma.noteVersion.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.note.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.subTask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.taskList.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.userWebPushSubscription.deleteMany();
  await prisma.twoFactorAuth.deleteMany();
  await prisma.recoveryCode.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.user.deleteMany();

  logger.info('Baza danych wyczyszczona.');
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const lang = parseLang(args);
  const clearOnly = isClearOnly(args);

  logger.info('=== Reborn Apps — Seed Script ===');

  // Step 1: Clear existing data
  await clearDatabase();

  if (clearOnly) {
    logger.info('Tryb --clear: baza wyczyszczona, seedowanie pominięte.');
    return;
  }

  logger.info(`Seedowanie danych demo (język: ${lang.toUpperCase()})...`);

  // Step 2: Create user with real encryption
  const crypto = CryptoManager.getInstance();

  logger.info('Generowanie klucza masterowego i hashowanie hasła...');
  const passwordHash = await hashPassword(DEMO_USER.password);

  // Generate master key, encrypt it, then load it into CryptoManager for encrypting data
  const masterKey = await crypto.generateMasterKey();
  const { encryptedMasterKey, salt: masterKeySalt } = await crypto.encryptMasterKey(
    masterKey,
    DEMO_USER.password
  );

  // Load master key into CryptoManager so we can encrypt data
  await loadUserMasterKey(encryptedMasterKey, masterKeySalt, DEMO_USER.password);

  const user = await prisma.user.create({
    data: {
      username: DEMO_USER.username,
      password_hash: passwordHash,
      master_key_encrypted: encryptedMasterKey,
      master_key_salt: masterKeySalt
    }
  });

  logger.info(`Użytkownik "${user.username}" utworzony (id: ${user.id})`);

  // Step 3: Create task lists
  const taskListMap = new Map<string, string>(); // key → id

  for (const list of TASK_LISTS) {
    const nameEncrypted = await crypto.encryptString(list.name[lang]);
    const created = await prisma.taskList.create({
      data: {
        user_id: user.id,
        name_encrypted: nameEncrypted,
        is_default: list.isDefault,
        order_index: list.orderIndex
      }
    });
    taskListMap.set(list.key, created.id);
  }

  logger.info(`Utworzono ${TASK_LISTS.length} list zadań`);

  // Step 4: Create tasks with metadata
  let taskCount = 0;
  let subtaskCount = 0;

  for (const task of TASKS) {
    const listId = taskListMap.get(task.listKey);
    if (!listId) throw new Error(`Unknown task list key: ${task.listKey}`);

    const titleEncrypted = await crypto.encryptString(task.title[lang]);
    const descriptionEncrypted = task.description
      ? await crypto.encryptString(task.description[lang])
      : null;

    const { dueDate, hasTime } = computeDue(task);

    const metadata: TaskSensitiveMetadata = {
      is_completed: task.isCompleted,
      is_starred: task.isStarred,
      due_date: dueDate,
      has_time: hasTime,
      completed_at: task.isCompleted ? computeCompletedAt(task.completedDaysAgo ?? 0) : null,
      reminder_date: null,
      is_recurring: false,
      notification_sent: false
    };

    const metadataEncrypted = await crypto.encryptObject(metadata);

    const createdTask = await prisma.task.create({
      data: {
        user_id: user.id,
        task_list_id: listId,
        title_encrypted: titleEncrypted,
        description_encrypted: descriptionEncrypted,
        metadata_encrypted: metadataEncrypted,
        position: task.position
      }
    });

    taskCount++;

    // Create subtasks
    if (task.subtasks) {
      for (const sub of task.subtasks) {
        const subNameEncrypted = await crypto.encryptString(sub.name[lang]);
        const subMetadata: SubtaskSensitiveMetadata = {
          is_completed: sub.isCompleted
        };
        const subMetadataEncrypted = await crypto.encryptObject(subMetadata);

        await prisma.subTask.create({
          data: {
            task_id: createdTask.id,
            name_encrypted: subNameEncrypted,
            metadata_encrypted: subMetadataEncrypted,
            position: sub.position
          }
        });
        subtaskCount++;
      }
    }
  }

  logger.info(`Utworzono ${taskCount} zadań i ${subtaskCount} podzadań`);

  // Step 5: Create folders
  const folderMap = new Map<string, string>(); // key → id

  for (const folder of FOLDERS) {
    const nameEncrypted = await crypto.encryptString(folder.name[lang]);
    const created = await prisma.folder.create({
      data: {
        user_id: user.id,
        name_encrypted: nameEncrypted,
        order_index: folder.orderIndex
      }
    });
    folderMap.set(folder.key, created.id);
  }

  logger.info(`Utworzono ${FOLDERS.length} folderów`);

  // Step 6: Create tags
  const tagMap = new Map<string, string>(); // key → id

  for (const tag of TAGS) {
    const nameEncrypted = await crypto.encryptString(tag.name[lang]);
    const colorEncrypted = await crypto.encryptString(tag.color);
    const created = await prisma.tag.create({
      data: {
        user_id: user.id,
        name_encrypted: nameEncrypted,
        color_encrypted: colorEncrypted
      }
    });
    tagMap.set(tag.key, created.id);
  }

  logger.info(`Utworzono ${TAGS.length} tagów`);

  // Step 7: Create notes with metadata and tag assignments
  let noteCount = 0;

  for (const note of NOTES) {
    const folderId = folderMap.get(note.folderKey);
    if (!folderId) throw new Error(`Unknown folder key: ${note.folderKey}`);

    const titleEncrypted = await crypto.encryptString(note.title[lang]);
    const contentEncrypted = await crypto.encryptString(note.content[lang]);

    // Generate excerpt from content (first 200 chars, plain text)
    const plainText = note.content[lang]
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_`~[\]]/g, '')
      .replace(/\n+/g, ' ')
      .trim();
    const excerpt = plainText.slice(0, 200);
    const excerptEncrypted = await crypto.encryptString(excerpt);

    // Resolve tag IDs for metadata
    const resolvedTagIds: string[] = [];
    if (note.tagKeys) {
      for (const tagKey of note.tagKeys) {
        const tagId = tagMap.get(tagKey);
        if (tagId) resolvedTagIds.push(tagId);
      }
    }

    const metadata: NoteSensitiveMetadata = {
      is_starred: note.isStarred || undefined,
      is_pinned: note.isPinned || undefined,
      tags: resolvedTagIds.length > 0 ? resolvedTagIds : undefined
    };

    const metadataEncrypted = await crypto.encryptObject(metadata);

    // Compute created_at date (days ago from now)
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - note.createdDaysAgo);

    const createdNote = await prisma.note.create({
      data: {
        user_id: user.id,
        folder_id: folderId,
        title_encrypted: titleEncrypted,
        content_encrypted: contentEncrypted,
        excerpt_encrypted: excerptEncrypted,
        metadata_encrypted: metadataEncrypted,
        order_index: note.orderIndex,
        created_at: createdAt,
        updated_at: createdAt
      }
    });

    noteCount++;
  }

  logger.info(`Utworzono ${noteCount} notatek`);

  // Step 8: Summary
  console.log('\n' + '='.repeat(50));
  console.log('  SEED COMPLETED SUCCESSFULLY');
  console.log('='.repeat(50));
  console.log(`  Język:         ${lang.toUpperCase()}`);
  console.log(`  Użytkownik:    ${DEMO_USER.username}`);
  console.log(`  Hasło:         ${DEMO_USER.password}`);
  console.log('  ---');
  console.log(`  Listy zadań:   ${TASK_LISTS.length}`);
  console.log(`  Zadania:       ${taskCount}`);
  console.log(`  Podzadania:    ${subtaskCount}`);
  console.log(`  Foldery:       ${FOLDERS.length}`);
  console.log(`  Tagi:          ${TAGS.length}`);
  console.log(`  Notatki:       ${noteCount}`);
  console.log('='.repeat(50));
  console.log('  Zaloguj się w aplikacji jako:');
  console.log(`  → username: ${DEMO_USER.username}`);
  console.log(`  → password: ${DEMO_USER.password}`);
  console.log('='.repeat(50) + '\n');
}

main()
  .catch((error) => {
    logger.error('Fatal error during seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
