import { describe, it, expect } from 'vitest';
import { prisma } from './client';

describe('@reborn/database', () => {
  it('should export prisma client', () => {
    expect(prisma).toBeDefined();
    expect(prisma.$connect).toBeDefined();
    expect(prisma.$disconnect).toBeDefined();
  });

  it('should have user model', () => {
    expect(prisma.user).toBeDefined();
    expect(prisma.user.create).toBeDefined();
    expect(prisma.user.findUnique).toBeDefined();
    expect(prisma.user.update).toBeDefined();
    expect(prisma.user.delete).toBeDefined();
  });

  it('should have task-related models', () => {
    expect(prisma.taskList).toBeDefined();
    expect(prisma.task).toBeDefined();
    expect(prisma.subTask).toBeDefined();
  });

  it('should have note-related models', () => {
    expect(prisma.note).toBeDefined();
    expect(prisma.folder).toBeDefined();
    expect(prisma.tag).toBeDefined();
  });
});
