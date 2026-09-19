import { describe, expect, it } from 'vitest';

import { sliceMainRecordsAtTurn } from '#/workspace/sessionLifecycle/internal/forkTurnSlice';
import type { WireRecord } from '#/wire/record';

function userTurnRecord(text: string, time: number): WireRecord {
  return {
    type: 'context.append_message',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      origin: { kind: 'user' },
    },
    time,
  };
}

describe('sliceMainRecordsAtTurn', () => {
  it('derives a fork last prompt from readable client metadata while retaining the original message', () => {
    const record: WireRecord = { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '<browser_ref>serialized</browser_ref>' }], origin: { kind: 'user', clientMetadata: [{ display_text: 'Save button · Rename it' }] } }, time: 2 };
    const slice = sliceMainRecordsAtTurn([{ type: 'metadata', protocol_version: '1.5', created_at: 1 }, record, userTurnRecord('next', 3)], 'example-source', 0);
    expect(slice.lastPrompt).toBe('Save button · Rename it');
    expect(slice.records).toContainEqual(record);
  });

  it('keeps cron records that fall inside a truncated fork slice', () => {
    const records: WireRecord[] = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1 },
      {
        type: 'cron.add',
        task: { id: 'aa11bb22', cron: '0 9 * * *', prompt: 'legacy', createdAt: 2 },
        time: 2,
      },
      userTurnRecord('hello', 3),
      { type: 'cron.cursor', id: 'aa11bb22', lastFiredAt: 4, time: 4 },
      userTurnRecord('second turn', 5),
      { type: 'cron.add', task: { id: 'bb22cc33', cron: '0 10 * * *', prompt: 'late', createdAt: 6 }, time: 6 },
    ];

    const slice = sliceMainRecordsAtTurn(records, 'ses_source', 0);

    const types = slice.records.map((record) => record.type);
    expect(types).toContain('cron.add');
    expect(types).toContain('cron.cursor');
    expect(
      slice.records.filter((record) => record.type === 'cron.add'),
    ).toHaveLength(1);
    expect(types).toContain('metadata');
    expect(types).toContain('context.append_message');
  });

  it('pairs steered inputs to appended messages by reserved message id', () => {
    const append = (id: string, text: string, time: number): WireRecord => ({
      type: 'context.append_message',
      message: {
        id,
        role: 'user',
        content: [{ type: 'text', text }],
        origin: { kind: 'user', inTurn: true },
      },
      time,
    });
    const steer = (messageId: string, text: string, time: number): WireRecord => ({
      type: 'turn.steer',
      input: [{ type: 'text', text }],
      origin: { kind: 'user', inTurn: true },
      messageId,
      time,
    });
    const steerM2 = steer('m2', 'same', 4);
    const steerM1 = steer('m1', 'same', 5);
    const records: WireRecord[] = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1 },
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'first' }],
        origin: { kind: 'user' },
        promptId: 'p0',
        time: 2,
      },
      {
        type: 'context.append_message',
        message: {
          id: 'p0',
          role: 'user',
          content: [{ type: 'text', text: 'first' }],
          origin: { kind: 'user' },
        },
        time: 3,
      },
      append('m2', 'same', 4),
      steerM2,
      append('m1', 'same', 5),
      steerM1,
    ];

    const slice = sliceMainRecordsAtTurn(records, 'ses_source', 1);

    expect(slice.records).toContainEqual(steerM2);
    expect(slice.records).not.toContainEqual(steerM1);
  });
});
